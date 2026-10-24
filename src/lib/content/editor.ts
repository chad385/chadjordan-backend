/**
 * The article writer's editing pass, plus the JSON parsing it relies on.
 * Lives outside the route so it can be evaluated directly
 * (see scripts/eval-editor.ts).
 */

import Anthropic from "@anthropic-ai/sdk";

// ─── JSON repair ─────────────────────────────────────────────────────────────

/**
 * Repair broken JSON caused by unescaped double quotes inside string values.
 *
 * Claude sometimes outputs HTML like <a href="url"> inside a JSON string
 * without escaping the quotes. This function detects those unescaped quotes
 * and adds backslash escapes so JSON.parse can handle it.
 *
 * Heuristic: In valid JSON, a closing " is always followed by : , } ] or
 * whitespace before one of those. If a " inside a string is followed by
 * something else (like a letter), it's an unescaped interior quote.
 *
 * This function is a no-op on already-valid JSON.
 */
function repairJsonQuotes(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (escapeNext) {
      result.push(char);
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      result.push(char);
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        result.push(char);
      } else {
        // Is this closing the string, or an unescaped quote inside it?
        // Look ahead past any whitespace for a JSON structural character
        let j = i + 1;
        while (j < text.length && text[j] === " ") j++;
        const next = text[j];

        if (
          next === ":" || next === "," || next === "}" ||
          next === "]" || next === undefined
        ) {
          // Looks like a real string boundary
          inString = false;
          result.push(char);
        } else {
          // Unescaped quote inside a string value — escape it
          result.push("\\");
          result.push(char);
        }
      }
      continue;
    }

    result.push(char);
  }

  return result.join("");
}

/** Parse a JSON object out of a model response (bare, fenced, or embedded). */
export function parseModelJson<T>(responseText: string): T {
  // Control chars (incl. literal newlines) break JSON strings; unescaped quotes
  // inside HTML attributes are repaired before any parse attempt.
  const sanitized = repairJsonQuotes(responseText.replace(/[\x00-\x1F\x7F]/g, " "));

  try {
    return JSON.parse(sanitized.trim()) as T;
  } catch {
    // fall through
  }

  const fenceMatch = sanitized.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1]) as T;
    } catch {
      // fall through
    }
  }

  const startIdx = sanitized.indexOf("{");
  if (startIdx === -1) throw new Error("No JSON found in response");
  let depth = 0;
  let endIdx = -1;
  let inString = false;
  let escapeNext = false;
  for (let i = startIdx; i < sanitized.length; i++) {
    const char = sanitized[i];
    if (escapeNext) { escapeNext = false; continue; }
    if (char === "\\") { escapeNext = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === "{") depth++;
    if (char === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
  }
  if (endIdx === -1) throw new Error("No complete JSON object found in response");
  return JSON.parse(sanitized.slice(startIdx, endIdx + 1)) as T;
}

// ─── Editing pass ────────────────────────────────────────────────────────────

export interface ReviewFlag {
  sentence: string;
  reason: string;
}

export interface EditResult {
  body: string;
  excerpt: string;
  contrastFound: number;
  contrastKept: number;
  unsupportedClaims: ReviewFlag[];
  editorError: string | null;
}

/**
 * A second model pass over the draft. Two jobs:
 * 1. Style: cut the "it isn't X, it's Y" reflex down to one, and drop stock
 *    one-liner section closers. Meaning, facts, headings, links and FAQs stay.
 * 2. Client claims: check every statement about a named client against the
 *    brand context's proof section. Unsupported claims are a hard stop — they
 *    are FLAGGED, never silently fixed, so a human sees what was invented.
 * If this pass fails, the caller treats the draft as held for review.
 */
export async function editDraft(
  anthropic: Anthropic,
  brand: { fullContext: string },
  draft: { title: string; body: string; excerpt: string }
): Promise<EditResult> {
  const system = `You are the editor for a brand's articles. You receive a draft and the brand context. You do two separate jobs and return JSON.

${brand.fullContext}

JOB 1 — STYLE EDIT (apply these to the body):
- Find every sentence, or pair of sentences, that sets something up only to deny it: "It isn't A, it's B." / "The fix isn't A. It's B." / "Not because A. Because B." / "A is not B — it's C." / "requires B, not A." / "not what X, but what Y". Count them. Keep at most ONE (the strongest). Rewrite every other one as a direct statement of B.
- Remove stock closers: a section or paragraph that ends on a quotable one-liner, a three-beat fragment ("Nothing X. Nothing Y. Just Z."), or a symptom/disease metaphor. End on the last useful sentence instead.
- Do not change meaning, facts, headings, links, HTML structure, or the FAQ section's questions. Do not add any new claims, examples, or numbers. Keep length roughly the same.

JOB 2 — CLIENT-CLAIM CHECK (do NOT fix these):
- List every statement about a named client, person, or project (deliverables, process, order of work, timeline, outcomes, quotes, attributions).
- Check each against the PROOF section of the brand context (proof/case-studies and proof/testimonials), including its approved phrasings.
- SUPPORTED: the proof states it, OR the sentence is a faithful paraphrase of the proof — the same facts in different words, with nothing added. Example: the proof says the team "still uses the decision filter daily to judge whether a piece of creative, messaging, or positioning is on-brand"; "the team still runs creative and messaging decisions through it daily" is supported. Do not flag faithful paraphrases.
- UNSUPPORTED (hard stop): the sentence adds anything the proof doesn't contain — a deliverable, a cause, a consequence or cost, an order of work, a timeline, a number, a motive, a method detail, or a characterization of the people. Example: "the brand brain was the first deliverable" or "the gap was costing them in the first impression" are unsupported.
- For each unsupported claim: copy the sentence exactly into "unsupported_claims" and say what isn't supported. LEAVE THAT SENTENCE UNCHANGED in the body so a human reviewer can see it. Do not soften, delete, or rewrite it.
- Decide before you list. Only claims you conclude are NOT supported go in "unsupported_claims"; never list a claim and then say it's fine.

Return ONLY a JSON object, no commentary:
{"body": "the edited HTML body", "excerpt": "the excerpt, edited by the same style rules", "contrast_found": 0, "contrast_kept": 0, "unsupported_claims": [{"sentence": "...", "reason": "..."}]}
In "body", escape double quotes inside HTML attributes as \\" so the JSON stays valid.`;

  const user = `Title: ${draft.title}

Excerpt: ${draft.excerpt}

Body (HTML):
${draft.body}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const out = parseModelJson<{
      body?: string;
      excerpt?: string;
      contrast_found?: number;
      contrast_kept?: number;
      unsupported_claims?: ReviewFlag[];
    }>(text);
    if (!out.body || out.body.length < draft.body.length * 0.5) {
      throw new Error("Editor returned an empty or truncated body");
    }
    return {
      body: out.body,
      excerpt: out.excerpt || draft.excerpt,
      contrastFound: Number(out.contrast_found) || 0,
      contrastKept: Number(out.contrast_kept) || 0,
      unsupportedClaims: Array.isArray(out.unsupported_claims)
        ? out.unsupported_claims.filter((c) => c && c.sentence)
        : [],
      editorError: null,
    };
  } catch (err) {
    console.error("Editing pass failed:", err);
    return {
      body: draft.body,
      excerpt: draft.excerpt,
      contrastFound: 0,
      contrastKept: 0,
      unsupportedClaims: [],
      editorError: err instanceof Error ? err.message : "unknown error",
    };
  }
}
