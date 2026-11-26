import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { ASSISTANT_MAX_BODY_BYTES, ASSISTANT_RATE_WINDOW_SECONDS } from "./constants";
import {
  assistantNotConfiguredMessage,
  authenticateAssistantHeaders,
  readAssistantCredentials,
} from "./auth";
import { auditStoreReady, countRecentCalls, rateLimitExceeded, writeAudit } from "./audit";
import { fixedEqual } from "@/lib/api/signature";

type Admin = ReturnType<typeof createAdminClient>;

export interface AssistantContext {
  supabase: Admin;
  keyId: string;
  bodyText: string;
  origin: string;
  requestUrl: string;
}

export interface AssistantOutcome {
  response: NextResponse;
  targetTable?: string | null;
  targetId?: string | null;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

function jsonError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status });
}

/**
 * Gate for every assistant route. Unset or master-overlapping credentials
 * return 503 before any read of the database, model, or stored body work.
 * HMAC is required even when API_SIGNATURE_REQUIRED is false.
 */
export async function handleAssistant(
  request: NextRequest,
  action: string,
  run: (ctx: AssistantContext) => Promise<AssistantOutcome>,
  options?: { maxBodyBytes?: number }
): Promise<NextResponse> {
  const maxBodyBytes = options?.maxBodyBytes ?? ASSISTANT_MAX_BODY_BYTES;
  const creds = readAssistantCredentials(process.env);
  if (!creds.ok) {
    return jsonError(assistantNotConfiguredMessage(creds.reason), 503);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return jsonError("Request body is too large", 413);
  }

  const bodyText = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
  if (bodyText.length > maxBodyBytes) {
    return jsonError("Request body is too large", 413);
  }

  const pathname = new URL(request.url).pathname;
  const presentedKey = request.headers.get("x-api-key");
  const keyMatches = Boolean(presentedKey && fixedEqual(presentedKey, creds.apiKey));
  const auth = authenticateAssistantHeaders(process.env, {
    apiKey: presentedKey,
    timestamp: request.headers.get("x-timestamp"),
    signature: request.headers.get("x-signature"),
    method: request.method,
    pathname,
    bodyText,
  });

  if (!auth.ok) {
    if (auth.status === 503) return jsonError(auth.error, 503);
    if (keyMatches) {
      const supabase = createAdminClient();
      if (await auditStoreReady(supabase)) {
        await writeAudit(supabase, {
          keyId: `assistant:rejected`,
          method: request.method,
          path: pathname,
          action: "auth_rejected",
          statusCode: 401,
          requestBytes: bodyText.length,
          error: auth.error,
        });
      }
    }
    return jsonError("Unauthorized", 401);
  }

  const supabase = createAdminClient();
  if (!(await auditStoreReady(supabase))) {
    return jsonError("Assistant audit log is not ready. Apply the assistant audit migration.", 503);
  }

  const recent = await countRecentCalls(supabase, auth.keyId);
  if (recent === null) {
    return jsonError("Assistant audit log is not ready. Apply the assistant audit migration.", 503);
  }
  if (rateLimitExceeded(recent)) {
    await writeAudit(supabase, {
      keyId: auth.keyId,
      method: request.method,
      path: pathname,
      action,
      statusCode: 429,
      requestBytes: bodyText.length,
      error: "Rate limit exceeded",
    });
    return jsonError("Rate limit exceeded", 429, { retry_after_seconds: ASSISTANT_RATE_WINDOW_SECONDS });
  }

  let outcome: AssistantOutcome;
  try {
    outcome = await run({
      supabase,
      keyId: auth.keyId,
      bodyText,
      origin: request.nextUrl.origin,
      requestUrl: request.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Assistant request failed";
    console.error(`assistant ${action} failed`, message);
    outcome = {
      response: jsonError("Assistant request failed", 500),
      error: message,
    };
  }

  await writeAudit(supabase, {
    keyId: auth.keyId,
    method: request.method,
    path: pathname,
    action,
    statusCode: outcome.response.status,
    targetTable: outcome.targetTable,
    targetId: outcome.targetId,
    requestBytes: bodyText.length,
    error: outcome.error ?? (outcome.response.ok ? null : "request failed"),
    metadata: outcome.metadata,
  });

  return outcome.response;
}
