/**
 * Finds "X-not-Y" contrast constructions in an article body.
 *
 * The model can't be trusted to count these in its own writing (it reported
 * zero on a draft that had five), so this is a plain, deterministic check the
 * writer runs after the editing pass. It catches the blunt form ("It isn't A.
 * It's B.") and the softer ones ("look newer, not more established", "not to
 * list services, but to give…", "rather than", "instead of").
 *
 * Text inside quotation marks and blockquotes is ignored, so client quotes
 * never count against the article.
 */

export interface ContrastHit {
  sentence: string;
  pattern: string;
}

const NEG_COPULA = String.raw`(?:isn't|is not|aren't|are not|wasn't|was not|weren't|were not)`;
const NEG_AUX = String.raw`(?:isn't|is not|aren't|are not|wasn't|was not|weren't|were not|doesn't|does not|don't|do not|didn't|did not|won't|will not)`;
const PRONOUN = String.raw`(?:it|they|that|this|he|she|we|you)`;
const AFFIRM = String.raw`(?:'s|'re| is| are| was| were)`;

// Patterns that make a single sentence a contrast on their own.
const IN_SENTENCE: Array<[string, RegExp]> = [
  // "look newer, not more established" / "built for the competitor's firm, not this one"
  ["comma-not", /,\s+not\s+(?!only\b|just\b|sure\b|least\b|always\b|yet\b|once\b)\w/i],
  // "not to list services, but to give…" / "not X but Y"
  ["not-but", /\bnot\b[^.;:!?]{1,120}?\bbut\b/i],
  // "isn't X — it's Y" / "doesn't drift — it never cohered" / "isn't X; it's Y"
  ["neg-dash-pos", new RegExp(String.raw`\b${NEG_AUX}\b[^.!?]{0,120}?\s*[—–;]\s*${PRONOUN}\b`, "i")],
  // "Most brands aren't broken, they're buried."
  ["neg-comma-pos", new RegExp(String.raw`\b${NEG_COPULA}\b[^.!?]{0,100}?,\s*${PRONOUN}${AFFIRM}\b`, "i")],
  ["rather-than", /\brather than\b/i],
  ["instead-of", /\binstead of\b/i],
  // "Not because the client is foolish." (the setup half of a two-sentence turn)
  ["not-fragment", /^not\s+(?:because|just|only|a|an|the|about|what|that|to)\b/i],
];

// A negated sentence followed by one that restates the subject affirmatively:
// "The fix isn't a better logo. The fix is finding what's true."
const CROSS_A = new RegExp(String.raw`\b${NEG_COPULA}\b|\bnot (?:a|an|the|about|what|just|only)\b`, "i");
const CROSS_B = new RegExp(
  String.raw`^(?:${PRONOUN}|the [\w-]+(?: [\w-]+)?|[\w-]+)${AFFIRM}\b|^(?:but|instead|rather|because)\b`,
  "i"
);

function normalize(text: string): string {
  return text.replace(/[‘’]/g, "'");
}

/** Strip HTML to plain sentences, dropping blockquotes and quoted speech. */
export function articleSentences(html: string): string[] {
  const text = normalize(html)
    .replace(/<blockquote[\s\S]*?<\/blockquote>/gi, " ")
    .replace(/<\/(p|h[1-6]|li|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    // Quoted speech belongs to whoever said it.
    .replace(/[“"][^”"\n]{2,}[”"]/g, '""');

  return text
    .split("\n")
    .flatMap((block) => block.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Every contrast construction in the body, one hit per sentence (or pair). */
export function findContrasts(html: string): ContrastHit[] {
  const sentences = articleSentences(html);
  const hits: ContrastHit[] = [];
  const used = new Set<number>();

  for (let i = 0; i < sentences.length; i++) {
    if (used.has(i)) continue;
    const s = sentences[i];

    const match = IN_SENTENCE.find(([, re]) => re.test(s));
    if (match) {
      hits.push({ sentence: s, pattern: match[0] });
      used.add(i);
      continue;
    }

    const next = sentences[i + 1];
    if (next && CROSS_A.test(s) && CROSS_B.test(next)) {
      hits.push({ sentence: `${s} ${next}`, pattern: "two-sentence" });
      used.add(i);
      used.add(i + 1);
    }
  }
  return hits;
}
