import assert from "node:assert/strict";
import test from "node:test";
import { composeSubject, pickFraming, repeatReason } from "./image.ts";

// Real subjects the engine produced on 2026-10-24.
const LAMP_NOTEBOOK =
  "Stills archive of a desk lamp casting a small warm pool over a well-worn notebook left open beside a cold cup of coffee, in a dim ordinary office room";
const MICROPHONE =
  "Stills archive of a desk microphone left on in a dim room, its small indicator light glowing warm amber against cold navy shadows, a notepad closed beside it";
const BINDERS = "Stills archive of a shelf of identical binders in a dim office corner, one lamp on nearby";

test("flags the desk-and-lamp cliché even with no history", () => {
  assert.match(repeatReason(LAMP_NOTEBOOK, []) ?? "", /cliché/);
});

test("flags a recent cliché object reused", () => {
  // binders reuses "lamp" from the notebook image
  assert.ok(repeatReason(BINDERS, [LAMP_NOTEBOOK]));
  // microphone reuses "desk" from the notebook image
  assert.ok(repeatReason(MICROPHONE, [LAMP_NOTEBOOK]));
});

test("flags two shared scene words with any recent image", () => {
  const a = "Stills archive of a stairwell landing with a coat over the railing under a single bulb";
  const b = "Stills archive of a stairwell railing with a scarf caught on it under a bulb";
  assert.ok(repeatReason(b, [a]));
});

test("passes a genuinely different scene", () => {
  const garage =
    "Stills archive of a parking garage at night, one car's dome light on above an open laptop bag left on the passenger seat";
  assert.equal(repeatReason(garage, [LAMP_NOTEBOOK, MICROPHONE, BINDERS]), null);
});

test("doctrine words alone never count as a repeat", () => {
  const a = "Stills archive of a dim cold navy room, one small warm light";
  const b = "Stills archive of a loading dock in cold navy dark, one small warm light over the door";
  assert.equal(repeatReason(b, [a]), null);
});

test("composeSubject fixes the article", () => {
  assert.equal(composeSubject("Stills archive of a", "an empty stairwell."), "Stills archive of an empty stairwell");
  assert.equal(composeSubject("Stills archive of a", "parking garage"), "Stills archive of a parking garage");
});

test("the doctrine's foreground words don't make two different scenes a repeat", () => {
  const printRoom =
    "Stills archive of a dim print room at night, freshly printed pages on an idle printer, its status light glowing warm, the edge of a metal shelf soft and dark in the foreground";
  const kitchenette =
    "Stills archive of a kitchenette at night, a vending machine throwing a small warm glow, the near counter edge soft and dark in the foreground";
  assert.equal(repeatReason(kitchenette, [printRoom]), null);
});

test("pickFraming skips the two most recent framings", () => {
  const list = ["A", "B", "C", "D"];
  for (const seed of ["x", "y", "z", "slug-1", "slug-2"]) {
    const f = pickFraming(seed, list, ["A", "B"]);
    assert.ok(f === "C" || f === "D", `${seed} → ${f}`);
  }
});
