import assert from "node:assert/strict";
import test from "node:test";
import { CAPTURE_IP_LIMIT, CAPTURE_KEY_LIMIT, captureBuckets, captureLimitExceeded } from "./capture-rate.ts";

test("capture limits are per key and per IP, and the raw key is not the stored id", () => {
  const buckets = captureBuckets("capture-secret", "203.0.113.8");
  assert.equal(buckets[0].limit, CAPTURE_KEY_LIMIT);
  assert.equal(buckets[1].limit, CAPTURE_IP_LIMIT);
  assert.equal(buckets[0].fingerprint.startsWith("key:"), true);
  assert.equal(buckets[0].fingerprint.includes("capture-secret"), false);
  assert.notEqual(captureBuckets("other-secret", "203.0.113.8")[0].fingerprint, buckets[0].fingerprint);
  assert.equal(captureBuckets("capture-secret", "203.0.113.8")[1].fingerprint, buckets[1].fingerprint);
  assert.equal(captureLimitExceeded(29, 30), false);
  assert.equal(captureLimitExceeded(30, 30), true);
});
