import assert from "node:assert/strict";
import test from "node:test";
import { renderNoteMarkdown } from "./note-markdown.ts";

test("note markdown renders text, lists, and safe links", () => {
  const html = renderNoteMarkdown("**Quiet** site.\n\n- one\n- [proof](https://example.com/a)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))");
  assert.match(html, /<strong>Quiet<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /href="https:\/\/example.com\/a"/);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("javascript:"), false);
  assert.match(html, />bad</);
});
