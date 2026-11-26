import assert from "node:assert/strict";
import test from "node:test";
import { backendPublicOrigin, isUnsubscribeToken, unsubscribeLinks } from "./unsubscribe.ts";

test("unsubscribe links stay on the backend origin", () => {
  const token = "11111111-1111-4111-8111-111111111111";
  const links = unsubscribeLinks("https://chadjordan-backend.chad-1a0.workers.dev/", token);
  assert.equal(
    links.page,
    "https://chadjordan-backend.chad-1a0.workers.dev/unsubscribe?t=11111111-1111-4111-8111-111111111111"
  );
  assert.equal(
    links.oneClick,
    "https://chadjordan-backend.chad-1a0.workers.dev/api/unsubscribe?t=11111111-1111-4111-8111-111111111111"
  );
  assert.equal(isUnsubscribeToken(token), true);
  assert.equal(isUnsubscribeToken("not-a-token"), false);
  assert.equal(backendPublicOrigin({}), "https://chadjordan-backend.chad-1a0.workers.dev");
  assert.equal(backendPublicOrigin({ BACKEND_PUBLIC_URL: "https://backend.example/" }), "https://backend.example");
});
