import assert from "node:assert/strict";
import test from "node:test";
import { failureAlertDue, heartbeatDue, TICK_FAILURE_COOLDOWN_MS } from "./tick-alert.ts";

test("tick failure mail waits six hours and the heartbeat is once per UTC day", () => {
  const now = new Date("2026-11-26T18:00:00.000Z");
  assert.equal(failureAlertDue(null, now), true);
  assert.equal(failureAlertDue(new Date(now.getTime() - TICK_FAILURE_COOLDOWN_MS + 1000).toISOString(), now), false);
  assert.equal(failureAlertDue(new Date(now.getTime() - TICK_FAILURE_COOLDOWN_MS - 1).toISOString(), now), true);
  assert.equal(heartbeatDue(null, now), true);
  assert.equal(heartbeatDue("2026-11-26", now), false);
  assert.equal(heartbeatDue("2026-11-25", now), true);
});
