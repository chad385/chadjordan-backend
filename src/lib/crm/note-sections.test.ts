import assert from "node:assert/strict";
import test from "node:test";
import { noteSectionKind, notesForSection } from "./note-sections.ts";

test("audit and outreach notes are separated and ordered oldest first", () => {
  const notes = [
    { activity_type: "note", title: "Audit: Later", created_at: "2026-11-02T00:00:00Z", data: { kind: "audit" } },
    { activity_type: "note", title: "Hello", created_at: "2026-11-01T00:00:00Z", data: { kind: "research" } },
    { activity_type: "note", title: "Outreach: Day 12", created_at: "2026-11-12T00:00:00Z", data: { kind: "outreach" } },
    { activity_type: "note", title: "Outreach: First", created_at: "2026-11-01T00:00:00Z", data: { kind: "outreach" } },
    { activity_type: "email_sent", title: "Sent", created_at: "2026-11-03T00:00:00Z", data: null },
  ];
  assert.equal(noteSectionKind(notes[1]), null);
  assert.deepEqual(notesForSection(notes, "outreach").map((note) => note.title), ["Outreach: First", "Outreach: Day 12"]);
  assert.equal(notesForSection(notes, "audit").length, 1);
  assert.equal(noteSectionKind({ activity_type: "note", title: "Audit: From the title", data: null }), "audit");
});
