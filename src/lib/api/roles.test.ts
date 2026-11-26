import assert from "node:assert/strict";
import test from "node:test";
import { sessionRole } from "./roles.ts";

test("only explicit admin and social roles are accepted", () => {
  assert.equal(sessionRole({ role: "admin" }), "admin");
  assert.equal(sessionRole({ role: "social" }), "social");
  assert.equal(sessionRole({ role: "Admin" }), null);
  assert.equal(sessionRole({}), null);
  assert.equal(sessionRole(null), null);
  assert.equal(sessionRole({ role: "owner" }), null);
});
