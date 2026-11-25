import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifySignedRequest } from "@/lib/api/signature";

/**
 * Session roles. 'admin' is the default (any user without an explicit role in
 * app_metadata). 'social' is the social media manager: full run of /social,
 * nothing else. API keys are unaffected.
 */
export type SessionRole = "admin" | "social";

export type AuthResult =
  | { authenticated: true; mode: "session"; userId: string; role: SessionRole }
  | { authenticated: true; mode: "api-key"; agent: string }
  | { authenticated: false; error: string };

export interface AuthOptions {
  /** Session roles allowed on this route. Defaults to admin-only, so the
   *  social role has to be explicitly opted in by the /api/social routes. */
  allowRoles?: SessionRole[];
}

function validateApiKey(key: string): AuthResult {
  if (key === process.env.API_SECRET_KEY) {
    return { authenticated: true, mode: "api-key", agent: "master" };
  }

  const agentKeys: Record<string, string | undefined> = {
    content_agent: process.env.CONTENT_AGENT_API_KEY,
    seo_agent: process.env.SEO_AGENT_API_KEY,
    analytics_agent: process.env.ANALYTICS_AGENT_API_KEY,
    email_agent: process.env.EMAIL_AGENT_API_KEY,
    openclawd: process.env.OPENCLAWD_API_KEY,
  };

  for (const [agent, agentKey] of Object.entries(agentKeys)) {
    if (agentKey && key === agentKey) {
      return { authenticated: true, mode: "api-key", agent };
    }
  }

  return { authenticated: false, error: "Invalid API key" };
}

async function validateApiSignature(request: NextRequest): Promise<AuthResult> {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    return { authenticated: false, error: "Missing x-api-key" };
  }

  const keyValidation = validateApiKey(apiKey);
  if (!keyValidation.authenticated) {
    return keyValidation;
  }

  const signatureRequired = (process.env.API_SIGNATURE_REQUIRED || "true").toLowerCase() !== "false";
  if (!signatureRequired) {
    return keyValidation;
  }

  const bodyText = await request.clone().text();
  const signed = verifySignedRequest({
    method: request.method,
    pathname: new URL(request.url).pathname,
    timestamp: request.headers.get("x-timestamp"),
    signature: request.headers.get("x-signature"),
    bodyText,
    signingSecret: process.env.API_REQUEST_SIGNING_SECRET || process.env.API_SECRET_KEY,
  });
  if (!signed.ok) return { authenticated: false, error: signed.error };
  return keyValidation;
}

async function validateSession(opts: AuthOptions = {}): Promise<AuthResult> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { authenticated: false, error: "Not authenticated" };
    }

    const role: SessionRole =
      (user.app_metadata as { role?: string } | null)?.role === "social" ? "social" : "admin";
    const allowed = opts.allowRoles || ["admin"];
    if (!allowed.includes(role)) {
      return { authenticated: false, error: "This account only has access to the social studio" };
    }

    return { authenticated: true, mode: "session", userId: user.id, role };
  } catch {
    return { authenticated: false, error: "Session validation failed" };
  }
}

export async function authenticateSession(
  _request: NextRequest,
  opts: AuthOptions = {}
): Promise<AuthResult> {
  void _request;
  return validateSession(opts);
}

export async function authenticateSessionOrApiKey(
  request: NextRequest,
  opts: AuthOptions = {}
): Promise<AuthResult> {
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    return validateApiSignature(request);
  }

  return validateSession(opts);
}

export function unauthorizedResponse(error: string = "Unauthorized") {
  return Response.json({ error }, { status: 401 });
}
