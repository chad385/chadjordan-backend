import { createHash, createHmac, timingSafeEqual } from "crypto";

/**
 * Machine-request signing shared by the master API and the assistant API.
 * Payload is `METHOD:pathname:timestamp:body`. The timestamp window is
 * `API_REQUEST_SIGNATURE_TTL_SECONDS` (default 300). Query strings are not
 * signed; callers sign the pathname only, and GET/HEAD bodies are empty.
 */

export const DEFAULT_SIGNATURE_TTL_SECONDS = 300;

export function signatureTtlSeconds(
  raw: string | undefined = process.env.API_REQUEST_SIGNATURE_TTL_SECONDS
): number {
  const value = Number(raw || DEFAULT_SIGNATURE_TTL_SECONDS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SIGNATURE_TTL_SECONDS;
}

export function requestSigningPayload(
  method: string,
  pathname: string,
  timestamp: string,
  bodyText: string
): string {
  return [method.toUpperCase(), pathname, timestamp, bodyText].join(":");
}

export function signRequestPayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function signaturesMatch(expected: string, actual: string): boolean {
  const normalizedActual = actual.replace(/^sha256=/, "").trim().toLowerCase();
  const normalizedExpected = expected.trim().toLowerCase();

  if (!normalizedActual || normalizedActual.length !== normalizedExpected.length) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(normalizedExpected, "utf8"),
    Buffer.from(normalizedActual, "utf8")
  );
}

/** Length-independent compare for secrets. */
export function fixedEqual(expected: string, actual: string): boolean {
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(actual).digest();
  return timingSafeEqual(left, right);
}

export function keyFingerprint(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 12);
}

export function verifySignedRequest(args: {
  method: string;
  pathname: string;
  timestamp: string | null;
  signature: string | null;
  bodyText: string;
  signingSecret: string | undefined;
  nowSeconds?: number;
  maxAgeSeconds?: number;
}): { ok: true } | { ok: false; error: string } {
  if (!args.timestamp || !args.signature) {
    return { ok: false, error: "Missing x-timestamp or x-signature for machine request" };
  }

  const timestampSeconds = Number(args.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, error: "Invalid x-timestamp" };
  }

  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAge = args.maxAgeSeconds ?? signatureTtlSeconds();
  if (Math.abs(nowSeconds - timestampSeconds) > maxAge) {
    return { ok: false, error: "Expired x-timestamp" };
  }

  if (!args.signingSecret) {
    return { ok: false, error: "API request signing secret is not configured" };
  }

  const expectedSignature = signRequestPayload(
    args.signingSecret,
    requestSigningPayload(args.method, args.pathname, args.timestamp, args.bodyText)
  );

  if (!signaturesMatch(expectedSignature, args.signature)) {
    return { ok: false, error: "Invalid x-signature" };
  }

  return { ok: true };
}
