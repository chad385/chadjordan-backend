import assert from "node:assert/strict";
import test from "node:test";
import { parseReviewUpdate } from "./review.ts";

test("review updates accept the three statuses and an optional comment", () => {
  const approved = parseReviewUpdate({ status: "approved", comment: "Send the sample." });
  assert.equal(approved.ok, true);
  if (approved.ok) {
    assert.equal(approved.status, "approved");
    assert.equal(approved.comment, "Send the sample.");
  }
  const plain = parseReviewUpdate({ status: "needs_changes" });
  assert.equal(plain.ok, true);
  if (plain.ok) assert.equal(plain.comment, null);
  assert.equal(parseReviewUpdate({ status: "published" }).ok, false);
  assert.equal(parseReviewUpdate({ status: "approved", workflow_id: "wf" }).ok, false);
});
