import assert from "node:assert/strict";
import test from "node:test";
import {
  requestSigningPayload,
  signRequestPayload,
  signatureTtlSeconds,
  verifySignedRequest,
} from "./signature.ts";

const secret = "test-signing-secret";
const body = '{"title":"Draft"}';
const timestamp = "1700000000";
const pathname = "/api/assistant/drafts";

function signed(overrides: Partial<Parameters<typeof verifySignedRequest>[0]> = {}) {
  const method = overrides.method || "POST";
  const path = overrides.pathname || pathname;
  const stamp = overrides.timestamp === undefined ? timestamp : overrides.timestamp;
  const payloadBody = overrides.bodyText === undefined ? body : overrides.bodyText;
  const payload = requestSigningPayload(method, path, stamp || "", payloadBody);
  return verifySignedRequest({
    method,
    pathname: path,
    timestamp: stamp,
    signature: signRequestPayload(overrides.signingSecret || secret, payload),
    bodyText: payloadBody,
    signingSecret: secret,
    nowSeconds: 1700000000,
    maxAgeSeconds: 300,
    ...overrides,
  });
}

test("payload is method, pathname, timestamp, and body", () => {
  assert.equal(
    requestSigningPayload("post", pathname, timestamp, body),
    `POST:${pathname}:${timestamp}:${body}`
  );
});

test("a fresh signature matches and the query string is not part of the payload", () => {
  assert.deepEqual(signed(), { ok: true });
  assert.equal(requestSigningPayload("GET", "/api/assistant/leads/lookup", timestamp, ""), `GET:/api/assistant/leads/lookup:${timestamp}:`);
});

test("expired timestamps, bad signatures, and a missing secret are rejected", () => {
  assert.equal(signed({ nowSeconds: 1700000401 }).ok, false);
  assert.equal(signed({ signature: "deadbeef" }).ok, false);
  assert.equal(signed({ signingSecret: undefined, signature: "abc" }).ok, false);
  assert.equal(signed({ timestamp: null, signature: null }).ok, false);
  assert.equal(signed({ timestamp: "not-a-time" }).ok, false);
});

test("ttl falls back to 300 seconds", () => {
  assert.equal(signatureTtlSeconds(undefined), 300);
  assert.equal(signatureTtlSeconds("0"), 300);
  assert.equal(signatureTtlSeconds("nope"), 300);
  assert.equal(signatureTtlSeconds("120"), 120);
});
