import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validatePlaybook } from "./playbook-contract.ts";

const playbook = JSON.parse(
  readFileSync(new URL("../../../brand/playbook.json", import.meta.url), "utf8")
) as { offerCore: { offerStatement: { finalStatement: string } }; meta: { selectedAudience: { description: string } } };

const text = JSON.stringify(playbook);

test("the repositioned playbook still satisfies the shelf contract", () => {
  assert.deepEqual(validatePlaybook(playbook), []);
});

test("positioning, audience, offers, and credentials are the supplied facts", () => {
  assert.match(text, /Brand worlds for firms that do serious, discreet work/);
  assert.match(text, /what a stranger concludes in ninety seconds/);
  assert.match(playbook.meta.selectedAudience.description, /investigations, forensics, incident response, and high-stakes advisory/i);
  assert.match(text, /win work by referral and get looked up afterward/);
  assert.match(text, /Sample Audit/);
  assert.match(text, /Strategic Session/);
  assert.match(text, /\$1,500/);
  assert.match(text, /2× Webby National Honoree/);
  assert.match(text, /20\+ years creative direction/);
  for (const pillar of [
    "reputation and the first lookup",
    "discretion and confidentiality in brand",
    "proof-led credibility for referral firms",
    "how buyers vet specialist firms",
  ]) {
    assert.match(text, new RegExp(pillar, "i"));
  }
});

test("retired proof, audiences, and the old line are absent", () => {
  const banned = [
    /inizio/i,
    /evoke/i,
    /trailblazer/i,
    /pharma/i,
    /healthcare/i,
    /life[-\s]?science/i,
    /smaller than you are/i,
    /look smaller/i,
    /\$2\s*b/i,
    /2b\+/i,
    /thrillist/i,
    /26\s*m/i,
    /durindal/i,
    /garrath/i,
    /hidalgo/i,
  ];
  for (const pattern of banned) {
    assert.equal(pattern.test(text), false, pattern.source);
  }
});
