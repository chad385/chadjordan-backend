import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fixedEqual, verifySignedRequest } from "@/lib/api/signature";
import { sessionRole, type SessionRole } from "@/lib/api/roles";

export type { SessionRole };

/**
 * Session roles come only from app_metadata.role. 'admin' can use the whole
 * dashboard. 'social' is limited to /social. Any other value, including a
 * missing role, is rejected. Machine calls use the master API key only.
 */

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
  const expected = process.env.API_SECRET_KEY;
  if (expected && fixedEqual(expected, key)) {
    return { authenticated: true, mode: "api-key", agent: "master" };
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

    const role = sessionRole(user.app_metadata);
    if (!role) {
      return { authenticated: false, error: "This account does not have access" };
    }
    const allowed = opts.allowRoles || ["admin"];
    if (!allowed.includes(role)) {
      return {
        authenticated: false,
        error:
          role === "social"
            ? "This account only has access to the social studio"
            : "This account does not have access",
      };
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
