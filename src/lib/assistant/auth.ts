import { fixedEqual, keyFingerprint, verifySignedRequest } from "../api/signature.ts";

export type AssistantCredentialRead =
  | { ok: true; apiKey: string; hmacSecret: string }
  | { ok: false; reason: "unset" | "overlaps-master" };

type EnvLike = Record<string, string | undefined>;

/**
 * Assistant credentials are a separate pair from the master machine key.
 * Either value missing, blank, or equal to the master key / master signing
 * secret is treated as not configured. Callers return 503 and do no work.
 */
export function readAssistantCredentials(env: EnvLike): AssistantCredentialRead {
  const apiKey = env.ASSISTANT_API_KEY?.trim() ?? "";
  const hmacSecret = env.ASSISTANT_HMAC_SECRET?.trim() ?? "";
  if (!apiKey || !hmacSecret) return { ok: false, reason: "unset" };

  const masterKey = env.API_SECRET_KEY?.trim() ?? "";
  const masterSigning = (env.API_REQUEST_SIGNING_SECRET || env.API_SECRET_KEY)?.trim() ?? "";
  const overlapsMaster =
    (masterKey && (apiKey === masterKey || hmacSecret === masterKey)) ||
    (masterSigning && (apiKey === masterSigning || hmacSecret === masterSigning));
  if (overlapsMaster) return { ok: false, reason: "overlaps-master" };

  return { ok: true, apiKey, hmacSecret };
}

export function assistantNotConfiguredMessage(reason: "unset" | "overlaps-master"): string {
  if (reason === "overlaps-master") {
    return "Assistant API credentials must not reuse the master API key";
  }
  return "Assistant API is not configured";
}

export type AssistantAuthResult =
  | { ok: true; keyId: string }
  | { ok: false; status: 503 | 401; error: string };

/**
 * Always requires HMAC. `API_SIGNATURE_REQUIRED=false` does not apply here,
 * and the master key is never accepted.
 */
export function authenticateAssistantHeaders(
  env: EnvLike,
  args: {
    apiKey: string | null;
    timestamp: string | null;
    signature: string | null;
    method: string;
    pathname: string;
    bodyText: string;
    nowSeconds?: number;
  }
): AssistantAuthResult {
  const creds = readAssistantCredentials(env);
  if (!creds.ok) {
    return { ok: false, status: 503, error: assistantNotConfiguredMessage(creds.reason) };
  }
  if (!args.apiKey || !fixedEqual(args.apiKey, creds.apiKey)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const signed = verifySignedRequest({
    method: args.method,
    pathname: args.pathname,
    timestamp: args.timestamp,
    signature: args.signature,
    bodyText: args.bodyText,
    signingSecret: creds.hmacSecret,
    nowSeconds: args.nowSeconds,
  });
  if (!signed.ok) return { ok: false, status: 401, error: signed.error };
  return { ok: true, keyId: `assistant:${keyFingerprint(creds.apiKey)}` };
}
