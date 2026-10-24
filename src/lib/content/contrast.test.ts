import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Node's strip-types runner requires the explicit .ts extension.
import { findContrasts } from "./contrast.ts";

const p = (s: string) => `<p>${s}</p>`;

// Every one of these is a real line from a test draft or the voice guide.
const CONTRASTS = [
  "A new logo makes the firm look newer, not more established.",
  "The site is built to carry the argument — not to list services, but to give the stranger the right read.",
  "The fix isn't a better logo. The fix is finding what is already true.",
  "It's not a creativity problem. It's a correction problem.",
  "Presentation is not decoration — it's the argument you make before you speak.",
  "Not because the client is foolish. Because the client is a stranger.",
  "Most brands aren't broken, they're buried.",
  "The method, described the way they'd describe it to a peer rather than a prospect.",
  "The brand doesn't drift — it never cohered in the first place.",
  "Mission statements are written to sound good, not to be true.",
  "They are not reading carefully. They are pattern-matching.",
  "The positioning was written from a template, not from what is particular about this team.",
  "The goal is not to build something new — it is to find what is already true.",
];

const PLAIN = [
  "Strangers make up their minds in about ninety seconds.",
  "When a prospect is not sure about your firm, price becomes the lever they pull. You discount to compensate.",
  "It does not tell a writer how the firm talks. It does not tell the AI tool what register to use.",
  "Not every firm needs a full rebuild.",
  "The work starts with a long conversation about what is true.",
];

for (const line of CONTRASTS) {
  test(`flags: ${line.slice(0, 60)}`, () => {
    assert.equal(findContrasts(p(line)).length, 1, line);
  });
}

for (const line of PLAIN) {
  test(`leaves alone: ${line.slice(0, 60)}`, () => {
    assert.equal(findContrasts(p(line)).length, 0, line);
  });
}

test("ignores quoted speech and blockquotes", () => {
  const html =
    p('Sebastian put it plainly: "Chad isn\'t the cheapest designer that way, and that\'s fine."') +
    "<blockquote><p>It isn't a logo, it's a system.</p></blockquote>";
  assert.equal(findContrasts(html).length, 0);
});

test("counts across a whole body and handles curly apostrophes", () => {
  const html =
    p("It’s not a design problem. It’s a clarity problem.") +
    p("Strangers decide fast.") +
    p("A new logo makes the firm look newer, not more established.");
  assert.equal(findContrasts(html).length, 2);
});
