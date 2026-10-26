/**
 * Evaluates the article writer's client-claim check against fixed cases.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/eval-editor.ts
 *
 * Loads the live brand_context (the same corpus the writer uses) and runs the
 * real editing pass on short Durindal passages: one built only from faithful
 * paraphrases of the proof (must NOT be flagged) and several that each add one
 * invented detail (must be flagged). Calls the model, so it costs a little.
 */

import Anthropic from "@anthropic-ai/sdk";
import { editDraft } from "../src/lib/content/editor.ts";

const RUNS = Number(process.env.EVAL_RUNS || 2);

const SITUATION =
  "<p>Durindal came in needing a website. Garrath and Sebastian were two founders with a thesis and no product yet, selling judgment to people who wire eight figures, and their presentation said they were new.</p>";

const CASES: Array<{ name: string; expectFlag: boolean; body: string }> = [
  {
    name: "faithful paraphrases only",
    expectFlag: false,
    body:
      SITUATION +
      "<p>We built Tactical Luxury: a complete identity, an image world, a site, and a decision filter. The team still runs creative and messaging decisions through it daily. By the time we were finished, they looked like a firm with a history.</p>",
  },
  {
    name: "paraphrase not in the approved list",
    expectFlag: false,
    body:
      SITUATION +
      "<p>The work gave them an identity, an image world, a site, and a decision filter. Every day, their team still checks new creative and messaging against that filter. When it was done, Durindal read like a firm that had been around for years.</p>",
  },
  {
    name: "invented deliverable",
    expectFlag: true,
    body:
      SITUATION +
      "<p>The brand brain was the first deliverable, and the identity, image world, and site were all built from it. By the time we were finished, they looked like a firm with a history.</p>",
  },
  {
    name: "invented consequence",
    expectFlag: true,
    body:
      SITUATION +
      "<p>The gap was costing them in the first impression, before they ever got to show what they knew. We built a complete identity, an image world, a site, and a decision filter.</p>",
  },
  {
    name: "invented number and timeline",
    expectFlag: true,
    body:
      SITUATION +
      "<p>We built a complete identity, an image world, a site, and a decision filter in six weeks, and their inbound leads doubled within the quarter.</p>",
  },
];

async function loadBrandContext(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const res = await fetch(`${url}/rest/v1/brand_context?select=key,category,content&order=category`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = (await res.json()) as Array<{ key: string; category: string; content: string }>;
  return rows.map((r) => `# ${r.category}/${r.key}\n\n${r.content}`).join("\n\n---\n\n");
}

const fullContext = await loadBrandContext();
const anthropic = new Anthropic();
let failures = 0;

for (const c of CASES) {
  for (let run = 1; run <= RUNS; run++) {
    const result = await editDraft(anthropic, { fullContext }, { title: "Eval", body: c.body, excerpt: "" });
    const flagged = result.unsupportedClaims.length > 0 || Boolean(result.editorError);
    const ok = flagged === c.expectFlag;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name} (run ${run}): ${flagged ? "flagged" : "not flagged"}`);
    for (const f of result.unsupportedClaims) console.log(`        - "${f.sentence}"`);
    if (result.editorError) console.log(`        editor error: ${result.editorError}`);
  }
}

console.log(failures === 0 ? "\nAll cases passed." : `\n${failures} case run(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
