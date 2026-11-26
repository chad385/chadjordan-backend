import assert from "node:assert/strict";
import test from "node:test";
import { deliveryWarning } from "./delivery.ts";

test("a real send needs safe mode off and a Resend key", () => {
  assert.equal(deliveryWarning({ safeMode: false, resendConfigured: true }), null);
  assert.match(deliveryWarning({ safeMode: true, resendConfigured: true }) || "", /Safe mode is on/);
  assert.match(deliveryWarning({ safeMode: false, resendConfigured: false }) || "", /RESEND_API_KEY/);
  assert.match(deliveryWarning({ safeMode: true, resendConfigured: false }) || "", /not delivered/);
});
