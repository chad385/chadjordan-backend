/**
 * Hero-image pieces shared by the article writer and scripts/regenerate-hero.ts:
 * the subject picker (with a code-level check against recent subjects), the
 * prompt builder, and the image call. Storage upload stays with the caller.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// ─── Framing ─────────────────────────────────────────────────────────────────

// Fallback framings, used only when brand_context has no
// content/image_compositions row. These say HOW the subject is shot (distance,
// angle, depth), never WHAT is in the frame. Rotated deterministically per slug.
export const DEFAULT_COMPOSITIONS = [
  "Framing: close, shallow depth of field, the subject sharp against a soft background.",
  "Framing: medium distance, eye level, the subject off-center with generous negative space.",
  "Framing: a wider view with the subject clearly readable in the middle distance.",
];

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Picks a framing for this image: starts from a slug-based position and skips
 * any framing used by the two most recent images, so consecutive thumbnails
 * aren't all shot from the same distance.
 */
export function pickFraming(seed: string, compositions: string[], recentFramings: string[] = []): string {
  const list = compositions.length > 0 ? compositions : DEFAULT_COMPOSITIONS;
  const start = hashString(seed) % list.length;
  const avoid = new Set(recentFramings.slice(0, 2));
  for (let i = 0; i < list.length; i++) {
    const candidate = list[(start + i) % list.length];
    if (!avoid.has(candidate)) return candidate;
  }
  return list[start];
}

/** "Stills archive of a" + "empty stairwell…" → "Stills archive of an empty stairwell…" */
export function composeSubject(opener: string, concept: string): string {
  const clean = concept.trim().replace(/\.$/, "");
  const endsWithArticle = /\s(a|an)$/i.test(opener);
  const noun = endsWithArticle ? clean.replace(/^(a|an|the)\s+/i, "") : clean;
  const lead = endsWithArticle ? opener.replace(/\s(a|an)$/i, /^[aeiou]/i.test(noun) ? " an" : " a") : opener;
  return `${lead} ${noun}`;
}

// ─── Variety check (code, not model) ─────────────────────────────────────────

// Words every on-doctrine subject shares; they say nothing about the scene.
const IGNORE = new Set(
  ("stills archive of a an the and with in on at by for from to into onto over under against across through " +
    "beside behind near nearby its their his her one two left still just someone has been after before " +
    "dim dark cold navy warm small soft light lit glow glowing casting cast pool ordinary room shadow shadows " +
    "night late empty quiet single faint low only blue gold amber " +
    // The doctrine asks every frame for a soft near-field foreground, so these recur by design.
    "foreground background near far edge mass frame end side dark").split(" ")
);

// The stock scene. Any of these, if a recent subject used one, counts as a repeat.
const CLICHE = new Set(["desk", "lamp", "notebook", "notepad", "journal", "pen", "coffee", "mug", "cup", "paper", "papers", "writing"]);

function singular(word: string): string {
  return word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function subjectTokens(subject: string): Set<string> {
  return new Set(
    subject
      .toLowerCase()
      .replace(/[^a-z\s-]/g, " ")
      .split(/[\s-]+/)
      .filter((w) => w.length >= 3 && !IGNORE.has(w))
      .map(singular)
  );
}

/** Why `candidate` repeats something in `recent` (newest first), or null if it's fresh. */
export function repeatReason(candidate: string, recent: string[]): string | null {
  const cand = subjectTokens(candidate);
  const cliche = [...cand].filter((w) => CLICHE.has(w));
  if (cand.has("desk") && cand.has("lamp")) return "it is the desk-and-lamp cliché";
  for (const prev of recent.slice(0, 3)) {
    const reused = cliche.filter((w) => subjectTokens(prev).has(w));
    if (reused.length) return `it reuses ${reused.join(", ")} from a recent image ("${prev}")`;
  }
  for (const prev of recent) {
    const shared = [...cand].filter((w) => subjectTokens(prev).has(w));
    if (shared.length >= 2) return `it shares ${shared.join(", ")} with a recent image ("${prev}")`;
  }
  return null;
}

// ─── Subject picker ──────────────────────────────────────────────────────────

export interface SubjectPick {
  concept: string;
  attempts: number;
  rejected: Array<{ concept: string; reason: string }>;
  stillRepeats: string | null;
}

const MAX_SUBJECT_ATTEMPTS = 3;

/**
 * Chooses the image subject from the article itself, told what recent images
 * showed. Each candidate goes through `repeatReason`; a repeat is sent back
 * with the reason, up to three tries.
 */
export async function pickImageSubject(
  anthropic: Anthropic,
  args: { title: string; excerpt: string; bodyText: string; imageStyle: string; opener: string; recent: string[] }
): Promise<SubjectPick> {
  const rejected: SubjectPick["rejected"] = [];
  let concept = "";
  let reason: string | null = null;

  for (let attempt = 1; attempt <= MAX_SUBJECT_ATTEMPTS; attempt++) {
    const recentList = args.recent.length ? args.recent.map((r) => `- ${r}`).join("\n") : "- (none yet)";
    const rejectedList = rejected.length
      ? `\n\nAlready rejected for this article (do not reuse their setting, object, or light source):\n${rejected
          .map((r) => `- ${r.concept} — rejected because ${r.reason}`)
          .join("\n")}`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 400,
      system: `You choose the subject of a blog hero photograph. Follow these image rules exactly:

${args.imageStyle}

Return ONLY JSON: {"concept": "..."} — a short noun phrase (12-30 words) that reads naturally after "${args.opener}". Name one specific setting, the specific object or moment that carries this article's argument, and the one warm light source. Literal, not a metaphor. No text, no documents with visible writing, no screens showing content.`,
      messages: [
        {
          role: "user",
          content: `Article title: ${args.title}
Excerpt: ${args.excerpt}

Article text (opening):
${args.bodyText.slice(0, 2500)}

Recent hero images on the site — yours must look clearly different: a different setting, a different object, and a different light source:
${recentList}${rejectedList}`,
        },
      ],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const match = text.match(/\{[\s\S]*\}/);
    try {
      concept = String(JSON.parse(match ? match[0] : text).concept || "").trim();
    } catch {
      concept = text.replace(/^[\s"]+|[\s"]+$/g, "").trim();
    }
    if (!concept) continue;

    reason = repeatReason(concept, args.recent);
    if (!reason) return { concept, attempts: attempt, rejected, stillRepeats: null };
    rejected.push({ concept, reason });
  }
  return { concept, attempts: MAX_SUBJECT_ATTEMPTS, rejected, stillRepeats: reason };
}

// ─── Prompt + render ─────────────────────────────────────────────────────────

const DEFAULT_STYLE = `Clean, modern editorial photography. A single clear focal subject,
uncluttered composition with negative space, natural directional light. Restrained and intentional.`;

export function buildImagePrompt(args: { subject: string; framing: string; imageStyle: string; imageAvoid: string }): string {
  const avoidLine = args.imageAvoid.trim() ? `\n- Avoid: ${args.imageAvoid.trim()}` : "";
  // Opens with the subject (the opener steers the frame), then framing, then the Visual DNA.
  return `${args.subject}.

${args.framing}

VISUAL DNA (apply this grade, palette, and mood to the whole frame):
${args.imageStyle || DEFAULT_STYLE}

CRITICAL RULES:
- ABSOLUTELY NO TEXT. No words, letters, numbers, logos, watermarks, or signatures
- No documents, charts, screens, books or paper with visible writing — these render as garbled fake text
- No faces turned toward the camera, no handshakes, no people pointing at screens
- Readable at thumbnail size: clear focal point, strong tonal contrast${avoidLine}`;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Error text that names the OpenAI org when the API reports one. */
export function describeOpenAIError(err: unknown): string {
  const headers = (err as { headers?: Headers | Record<string, string> })?.headers;
  const org =
    headers && typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("openai-organization")
      : (headers as Record<string, string> | undefined)?.["openai-organization"];
  const message = err instanceof Error ? err.message : String(err);
  return org ? `${message} (OpenAI org: ${org})` : message;
}

/**
 * Calls the image model and returns the image bytes (PNG by default; "webp"
 * asks GPT image models for a smaller WebP, as the 2.9.0 media path expects).
 * Throws on failure.
 */
export async function renderImage(
  openai: OpenAI,
  model: string,
  prompt: string,
  format: "png" | "webp" = "png"
): Promise<ArrayBuffer> {
  const isDalle = model.startsWith("dall-e");
  const response = (await openai.images.generate({
    model,
    prompt,
    n: 1,
    size: isDalle ? "1792x1024" : "1536x1024",
    quality: isDalle ? "hd" : "high",
    ...(isDalle
      ? { response_format: "url" }
      : format === "webp"
        ? { output_format: "webp", output_compression: 75 }
        : {}),
  } as Parameters<typeof openai.images.generate>[0])) as unknown as {
    data?: Array<{ b64_json?: string | null; url?: string | null }>;
  };
  const generated = response.data?.[0];
  if (generated?.b64_json) return base64ToArrayBuffer(generated.b64_json);
  if (generated?.url) {
    const res = await fetch(generated.url);
    if (!res.ok) throw new Error(`Image download failed: HTTP ${res.status}`);
    return res.arrayBuffer();
  }
  throw new Error("Image API returned no image data");
}

/** Plain text from article HTML, for the subject picker. */
export function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}
