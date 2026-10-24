/**
 * POST /api/write-article — AI-powered article writer
 *
 * Takes a calendar_entry_id, calls Claude to write the full article,
 * saves it to content_objects via the Frontend API, and updates the
 * calendar entry status.
 *
 * Respects publish mode:
 * - safe: article saved as "draft" for review
 * - autonomous: article saved as "published" directly
 */

import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getCloudflareContext } from "@opennextjs/cloudflare";


const FRONTEND_URL =
  process.env.DIGITAL_HOME_URL || "http://localhost:3000";
const API_KEY = process.env.API_SECRET_KEY || "";
const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

/**
 * Fetch from the Frontend Worker using the service binding (bypasses Workers-to-Workers routing issues).
 * Falls back to global fetch for local dev where no service binding exists.
 */
function frontendFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    const ctx = getCloudflareContext();
    const binding = ctx.env.FRONTEND_WORKER;
    if (binding) {
      return binding.fetch(new Request(`${FRONTEND_URL}${path}`, init));
    }
  } catch {
    // Local dev — no Cloudflare context available
  }
  return fetch(`${FRONTEND_URL}${path}`, init);
}

// ─── Brand context loader ────────────────────────────────────────────────────

interface BrandContext {
  fullContext: string;
  ctaLinks: string;
  authorName: string;
  imageStyle: string;
  imageAvoid: string;
  imageCompositions: string[];
}

async function loadBrandContext(): Promise<BrandContext> {
  const supabase = createAdminClient();

  const { data: dbContext } = await supabase
    .from("brand_context")
    .select("key, category, content")
    .order("category");

  const rows = dbContext || [];

  const fullContext = rows
    .map((row) => `# ${row.category}/${row.key}\n\n${row.content}`)
    .join("\n\n---\n\n");

  // Extract CTA links from brand context (category: "cta", key: "links")
  const ctaRow = rows.find((r) => r.category === "cta" && r.key === "links");
  const ctaLinks = ctaRow?.content || "";

  // Extract author name from brand context (category: "identity", key: "author")
  const authorRow = rows.find((r) => r.category === "identity" && r.key === "author");
  const authorName = authorRow?.content?.trim() || "Content Agent";

  // Image Visual DNA — config-driven so every generated image inherits the
  // brand's grade/palette/mood regardless of subject (category: "content").
  //   image_style  → the style DNA, prepended to every image prompt
  //   image_avoid  → the negative/avoid list, appended to every image prompt
  // Set these per instance in brand_context; the template ships neutral defaults.
  const imageRow = rows.find((r) => r.category === "content" && r.key === "image_style");
  const imageStyle = imageRow?.content?.trim() || "";
  const avoidRow = rows.find((r) => r.category === "content" && r.key === "image_avoid");
  const imageAvoid = avoidRow?.content?.trim() || "";
  //   image_compositions → one composition per line (a leading "- " is
  //   optional), rotated per article so consecutive images differ
  const compositionsRow = rows.find((r) => r.category === "content" && r.key === "image_compositions");
  const imageCompositions = (compositionsRow?.content || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));

  return { fullContext, ctaLinks, authorName, imageStyle, imageAvoid, imageCompositions };
}

// ─── Fetch existing articles for internal linking ────────────────────────────

async function fetchPublishedSlugs(): Promise<
  { slug: string; title: string; path: string }[]
> {
  try {
    const res = await frontendFetch(
      "/api/content?status=published&limit=20",
      { headers: { "x-api-key": API_KEY } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.data || data.articles || data.content || [];
    return items.map(
      (a: { slug: string; title: string }) => ({
        slug: a.slug,
        title: a.title,
        // Canonical URL on the site. Adjust if your frontend routes articles
        // under a different base path.
        path: `/blog/${a.slug}`,
      })
    );
  } catch {
    return [];
  }
}

// ─── Hero image generation ───────────────────────────────────────────────────

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// Fallback compositions, used only when brand_context has no
// content/image_compositions row. Kept neutral and literal so they never fight
// an instance's Visual DNA. Rotated deterministically per slug so consecutive
// articles never share a frame.
const DEFAULT_COMPOSITIONS = [
  "Composition: a single subject at a natural, human distance, eye level, with generous negative space.",
  "Composition: a close detail of an object or surface that carries the story, shallow depth of field.",
  "Composition: a quiet, wider view of a real room or place, with the subject clearly readable in the frame.",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

async function generateHeroImage(
  title: string,
  keyword: string,
  slug: string,
  imageStyle?: string,
  imageConcept?: string,
  imageAvoid?: string,
  imageCompositions: string[] = []
): Promise<{ url: string | null; error: string | null }> {
  if (!process.env.OPENAI_API_KEY) return { url: null, error: "OPENAI_API_KEY not set" };

  try {
    const openai = new OpenAI();

    // Placeholder Visual DNA — instances set their own in brand_context
    // (content/image_style). Kept deliberately neutral so the template is
    // brand-agnostic; the real grade/palette/mood comes from config.
    const defaultStyle = `Clean, modern editorial photography. A single clear focal subject,
uncluttered composition with negative space, natural directional light. Restrained and intentional.`;

    // The style DNA is PREPENDED to every prompt so the grade/palette/mood is
    // consistent no matter the subject — this is the CSG-PRO "Visual DNA" idea.
    const styleGuide = imageStyle || defaultStyle;
    const compositions = imageCompositions.length > 0 ? imageCompositions : DEFAULT_COMPOSITIONS;
    const composition = compositions[hashString(slug) % compositions.length];
    const subject = imageConcept
      ? `Subject (build the whole frame around this): ${imageConcept}`
      : `Subject: one literal moment from a real scene related to "${keyword}" — a single figure, a close trace of human presence, or a wider environment. A real place or object shown plainly, not a metaphor or symbol.`;

    // The config avoid list is APPENDED after the universal (model-safety) rules.
    const avoidLine = imageAvoid?.trim()
      ? `\n- Avoid: ${imageAvoid.trim()}`
      : "";

    const imagePrompt = `Create a hero image for a blog article titled "${title}" (topic: ${keyword}).

${subject}

VISUAL DNA (apply this grade, palette, and mood to the whole frame):
${styleGuide}
${composition}

CRITICAL RULES:
- ABSOLUTELY NO TEXT. No words, letters, numbers, logos, watermarks, or signatures
- No documents, charts, screens, books or paper with visible writing — these render as garbled fake text
- No faces turned toward the camera, no handshakes, no people pointing at screens
- Readable at thumbnail size: clear focal point, strong tonal contrast${avoidLine}`;

    const isDalleModel = OPENAI_IMAGE_MODEL.startsWith("dall-e");
    const response = await openai.images.generate({
      model: OPENAI_IMAGE_MODEL,
      prompt: imagePrompt,
      n: 1,
      size: isDalleModel ? "1792x1024" : "1536x1024",
      quality: isDalleModel ? "hd" : "high",
      ...(isDalleModel ? { response_format: "url" } : {}),
    } as Parameters<typeof openai.images.generate>[0]);

    const imageResponse = response as unknown as {
      data?: Array<{ b64_json?: string | null; url?: string | null }>;
    };
    const generated = imageResponse.data?.[0];
    let imageBuffer: ArrayBuffer | null = null;
    if (generated?.b64_json) {
      imageBuffer = base64ToArrayBuffer(generated.b64_json);
    } else if (generated?.url) {
      const imageRes = await fetch(generated.url);
      if (!imageRes.ok) return { url: null, error: `Image download failed: HTTP ${imageRes.status}` };
      imageBuffer = await imageRes.arrayBuffer();
    }
    if (!imageBuffer) return { url: null, error: "Image API returned no image data" };

    const supabase = createAdminClient();
    // Unique suffix so a new article's image can never overwrite an existing
    // article's hero — slugs can collide and get deduped after the image is made.
    const fileName = `blog/${slug}-${crypto.randomUUID().slice(0, 8)}-hero.png`;

    const { error: uploadError } = await supabase.storage
      .from("images")
      .upload(fileName, imageBuffer, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("Image upload failed:", uploadError.message);
      return { url: null, error: `Image upload failed: ${uploadError.message}` };
    }

    // Get the public URL
    const { data: publicUrl } = supabase.storage
      .from("images")
      .getPublicUrl(fileName);

    return { url: publicUrl.publicUrl, error: null };
  } catch (err) {
    console.error("Hero image generation failed:", err);
    return { url: null, error: err instanceof Error ? err.message : String(err) };
  }
}

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
function parseModelJson<T>(responseText: string): T {
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

interface ReviewFlag {
  sentence: string;
  reason: string;
}

interface EditResult {
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
async function editDraft(
  anthropic: Anthropic,
  brand: BrandContext,
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
- Check each against the PROOF section of the brand context (proof/case-studies and proof/testimonials). A claim is supported only if the proof section states it.
- For each unsupported claim: copy the sentence exactly into "unsupported_claims" and say what isn't supported. LEAVE THAT SENTENCE UNCHANGED in the body so a human reviewer can see it. Do not soften, delete, or rewrite it.

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

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const triggerSource =
    auth.mode === "api-key"
      ? { auth_mode: "api-key", triggered_by: auth.agent }
      : { auth_mode: "session", triggered_by: auth.userId };

  const body = await request.json();
  let { calendar_entry_id } = body;
  const publish_mode = body.publish_mode;

  // Check for Anthropic API key
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY not configured. Add it to .env.local to enable AI writing.",
      },
      { status: 500 }
    );
  }

  const supabase = createAdminClient();

  // If no calendar_entry_id, auto-select the next approved entry
  if (!calendar_entry_id) {
    const { data: nextEntry, error: selectError } = await supabase
      .from("content_calendar")
      .select("id")
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (selectError || !nextEntry) {
      return NextResponse.json(
        { error: "No approved entries in the content calendar. Approve a topic first." },
        { status: 404 }
      );
    }

    calendar_entry_id = nextEntry.id;
  }

  // 1. Fetch the calendar entry
  const { data: entry, error: entryError } = await supabase
    .from("content_calendar")
    .select("*")
    .eq("id", calendar_entry_id)
    .single();

  if (entryError || !entry) {
    return NextResponse.json(
      { error: "Calendar entry not found" },
      { status: 404 }
    );
  }

  // 2. Get publish mode from settings
  const { data: settingsData } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", "publish_mode")
    .single();

  // Explicit caller intent wins (a caller can force "safe" so its drafts
  // never auto-publish); otherwise fall back to the global setting.
  const publishMode =
    publish_mode === "autonomous" || publish_mode === "safe"
      ? publish_mode
      : settingsData?.value === "autonomous"
        ? "autonomous"
        : "safe";
  const targetStatus = publishMode === "autonomous" ? "published" : "draft";

  // 3. Mark as writing
  await supabase
    .from("content_calendar")
    .update({ status: "writing" })
    .eq("id", calendar_entry_id);

  try {
    // 4. Load brand context and existing articles
    const [brand, publishedArticles] = await Promise.all([
      loadBrandContext(),
      fetchPublishedSlugs(),
    ]);

    const internalLinks = publishedArticles.length > 0
      ? `\n\nExisting articles for internal linking (use these exact paths — they are the canonical URLs):\n${publishedArticles
          .map((a) => `- ${a.path} — "${a.title}"`)
          .join("\n")}`
      : "";

    // Build CTA instruction from brand context
    const ctaInstruction = brand.ctaLinks
      ? `- The CTA section MUST include one of the links below (choose the most relevant for the article topic). Use ONLY these exact links — do not modify the URLs or create new ones:\n${brand.ctaLinks}`
      : "- End with a CTA section that ties to the brand's offers. Match the article topic to the most relevant offer from the brand context.";

    // 5. Call Claude to write the article
    const anthropic = new Anthropic();

    const systemPrompt = `You are a Content Agent. You write articles optimized for human readers and AI systems.

${brand.fullContext}
${internalLinks}

IMPORTANT RULES:
- Write in the brand voice defined above. Follow the voice guide, tone examples, and banned phrases strictly.
- Match the tone and style in the tone examples — study them carefully. They define how the brand actually sounds.
- Reading level: 9th grade. Short sentences. Plain words. No jargon.
- Article length: 900-1,400 words. Make one point well and stop when it's made. Never pad to reach a length; padding is where filler lines and invented details come from.
- Ground every major claim in something concrete: a real case from the brand context, a number you can stand behind, or a step the reader can take today. If a section could appear on any competitor's blog unchanged, rewrite it with the brand's specific frameworks.
- CLIENT FACTS ARE FIXED: about any named client, person, or project, state only what the brand context's proof section says — deliverables, process, timeline, outcomes, quotes, and who said what. Never invent, infer, or embellish a client detail. If a detail you want isn't in the proof section, leave it out.
- Every paragraph should be a dense, contextually complete semantic unit. Prefer paragraph-based exposition over bullet points.
- Do NOT include the article title as an H1 or H2 at the start of the body — the website renders the title separately above the article. Start the body directly with the opening paragraph.
- Use HTML formatting: <h2>, <h3>, <p>, <blockquote>, <ul>, <li>, <strong>, <em>, <a> tags
${ctaInstruction}
- Output ONLY valid JSON — no markdown code fences, no commentary
- CRITICAL: In the "body" field, escape all double quotes inside HTML attributes using \\" so the JSON stays valid. For example: <a href=\\"https://example.com\\">text</a>
- Do NOT include any text before or after the JSON object`;

    const pillarDirective = entry.pillar_topic
      ? `\nContent pillar: ${entry.pillar_topic} — this article argues this pillar, using that pillar's framework from the brand context (see "Content pillars" there). Use the pillar's signature story only where it genuinely fits, and only with the facts the brand context gives.`
      : "";

    const userPrompt = `Write a full article for this topic:

Title: ${entry.title}
Target keyword: ${entry.target_keyword || "not specified"}
Keyword cluster: ${entry.keyword_cluster || "not specified"}
Intent type: ${entry.intent_type || "informational"}
Priority: ${entry.priority || "medium"}${pillarDirective}

Follow this structure:
1. Opening — a concrete situation the reader will recognize, stated plainly
2. The problem — what it is and what it costs them
3. Why the usual fixes fall short
4. What works — the approach, explained step by step
5. Proof — only if a case in the brand context genuinely fits, using only the facts given there
6. CTA — tie to one of the brand's offers (matched by topic relevance)

SEO requirements:
- Integrate target keyword 3-5 times naturally
- Use descriptive H2 headings (2-3 as direct questions)
- Include the target keyword in the first paragraph and one H2
- Include 2-3 internal links to existing articles where relevant, using the exact canonical paths from the list above (e.g. <a href="/blog/slug">text</a>)

FAQ section:
- After the CTA, add an FAQ section with 3-4 questions and answers
- Questions should be ones a reader would naturally ask after reading the article
- Answers should be 2-3 sentences each, direct and helpful
- Include the target keyword naturally in at least 2 FAQ answers
- Format as HTML: <h2>Frequently Asked Questions</h2> followed by <h3>question</h3><p>answer</p> pairs
- Also return the FAQs as structured data in the "faqs" field for JSON-LD schema

Return a JSON object with EXACTLY these fields:
{
  "title": "article title",
  "slug": "url-safe-slug",
  "body": "full HTML article body including FAQ section at the end",
  "excerpt": "150-200 character excerpt",
  "pull_quote": "the article's single most quotable line: a SHORT declarative statement, 8-14 words, punchy enough to stand alone on a poster. A claim, not an instruction — never starts with 'Learn' or 'Discover', no em dashes.",
  "semantic_tags": ["tag1", "tag2", "tag3"],
  "target_segments": ["segment1"],
  "content_type": "article",
  "image_concept": "one sentence describing a LITERAL, real moment that mirrors this article's subject — one of: a single figure absorbed in an action (in profile, eyes down, never facing the camera), a close trace of human presence (worn objects, a lit doorway, a used desk), or a quiet wider environment. A real place shown plainly at one distance, lit by one or two practical light sources. NOT a metaphor, symbol, or epic/surreal/monumental concept, not a 'world'. No text, no faces to camera, no documents, charts or screens.",
  "faqs": [{"question": "Q1?", "answer": "A1"}, {"question": "Q2?", "answer": "A2"}],
  "seo": {
    "title": "SEO meta title under 60 chars",
    "description": "meta description under 160 chars",
    "target_keyword": "primary keyword",
    "secondary_keywords": ["kw1", "kw2", "kw3"],
    "keyword_cluster": "cluster name",
    "schema_type": "Article"
  }
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      messages: [{ role: "user", content: userPrompt }],
      system: systemPrompt,
    });

    // 6. Parse the response
    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    // Extract JSON from response (handle potential markdown wrapping)
    let articleData!: {
      title: string;
      slug: string;
      body: string;
      excerpt: string;
      semantic_tags: string[];
      target_segments: string[];
      content_type: string;
      image_concept?: string;
      pull_quote?: string;
      faqs?: { question: string; answer: string }[];
      seo: {
        title: string;
        description: string;
        target_keyword: string;
        secondary_keywords: string[];
        keyword_cluster: string;
        schema_type: string;
      };
    };

    try {
      articleData = parseModelJson<typeof articleData>(responseText);
    } catch (parseError: unknown) {
      // Revert status
      await supabase
        .from("content_calendar")
        .update({ status: "approved" })
        .eq("id", calendar_entry_id);
      return NextResponse.json(
        {
          error: `Failed to parse AI response: ${parseError instanceof Error ? parseError.message : "unknown"}`,
        },
        { status: 500 }
      );
    }

    // 6b. Editing pass — style cleanup + client-claim check. Any unsupported
    // client claim (or a failed editor) holds the article as a draft, whatever
    // the publish mode, with the flags recorded for the reviewer.
    const edit = await editDraft(anthropic, brand, {
      title: articleData.title,
      body: articleData.body,
      excerpt: articleData.excerpt,
    });
    articleData.body = edit.body;
    articleData.excerpt = edit.excerpt;
    const held = edit.unsupportedClaims.length > 0 || Boolean(edit.editorError);
    const finalStatus = held ? "draft" : targetStatus;
    const holdNote = edit.editorError
      ? `[HELD: editing pass failed (${edit.editorError}) — review before publishing]`
      : edit.unsupportedClaims.length > 0
        ? `[HELD: unsupported client claims — do not publish until checked]\n${edit.unsupportedClaims
            .map((c) => `• "${c.sentence}" — ${c.reason}`)
            .join("\n")}`
        : null;

    // 7. Generate hero image (non-blocking — article still saves if this fails)
    const { url: heroImageUrl, error: heroImageError } = await generateHeroImage(
      articleData.title,
      entry.target_keyword || articleData.semantic_tags?.[0] || "business technology",
      articleData.slug,
      brand.imageStyle,
      articleData.image_concept,
      brand.imageAvoid,
      brand.imageCompositions
    );

    // 8. Save via Frontend API
    const publishPayload = {
      slug: articleData.slug,
      title: articleData.title,
      // The pull quote lives in `subtitle` — sites can render it as a quote tile.
      subtitle: articleData.pull_quote || null,
      body: articleData.body,
      excerpt: articleData.excerpt,
      content_type: articleData.content_type || "article",
      semantic_tags: articleData.semantic_tags || [],
      target_segments: articleData.target_segments || [],
      featured_image_url: heroImageUrl,
      status: finalStatus,
      created_by: "content_agent",
      author_name: brand.authorName,
      seo: {
        ...articleData.seo,
        og_image_url: heroImageUrl,
        // Include FAQs in SEO meta for FAQPage JSON-LD schema
        ...(articleData.faqs?.length ? { faqs: articleData.faqs } : {}),
      },
    };

    let articleResult: { id?: string; slug?: string } | null = null;

    const publishRes = await frontendFetch("/api/content", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify(publishPayload),
    });

    if (!publishRes.ok) {
      // Try with modified slug if duplicate
      const errData = await publishRes.json().catch(() => ({}));
      if (
        publishRes.status === 409 ||
        (errData.error && errData.error.includes("duplicate"))
      ) {
        publishPayload.slug = `${articleData.slug}-${Date.now().toString(36).slice(-4)}`;
        const retryRes = await frontendFetch("/api/content", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
          },
          body: JSON.stringify(publishPayload),
        });
        if (retryRes.ok) {
          articleResult = await retryRes.json();
        }
      }

      if (!articleResult) {
        // Revert status
        await supabase
          .from("content_calendar")
          .update({ status: "approved" })
          .eq("id", calendar_entry_id);
        return NextResponse.json(
          {
            error: "Failed to save article via Frontend API",
            debug: {
              frontend_url: FRONTEND_URL,
              status: publishRes.status,
              statusText: publishRes.statusText,
              response: errData,
            },
          },
          { status: 500 }
        );
      }
    } else {
      articleResult = await publishRes.json();
    }

    // 8. Update calendar entry
    await supabase
      .from("content_calendar")
      .update({
        status: finalStatus,
        content_object_id: articleResult?.id || null,
        ...(holdNote ? { notes: [holdNote, entry.notes].filter(Boolean).join("\n\n") } : {}),
      })
      .eq("id", calendar_entry_id);

    // 9. Log the action (non-blocking)
    frontendFetch("/api/agent-logs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        agent: "content_agent",
        action: "write_article",
        description: `Wrote article: ${articleData.title}`,
        status: "completed",
        target_table: "content_objects",
        target_id: articleResult?.id,
        input_data: {
          ...triggerSource,
          calendar_entry_id,
          requested_publish_mode: publish_mode || null,
        },
        output_data: {
          title: articleData.title,
          slug: publishPayload.slug,
          word_count: articleData.body.split(/\s+/).length,
          publishing_mode: publishMode,
          calendar_id: calendar_entry_id,
          held_for_review: held,
          unsupported_claims: edit.unsupportedClaims,
          editor_error: edit.editorError,
          contrast_found: edit.contrastFound,
          contrast_kept: edit.contrastKept,
          image_error: heroImageError,
        },
      }),
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      article: {
        title: articleData.title,
        slug: publishPayload.slug,
        status: finalStatus,
        word_count: articleData.body.split(/\s+/).length,
      },
      mode: publishMode,
      review: {
        held,
        unsupported_claims: edit.unsupportedClaims,
        editor_error: edit.editorError,
        contrast_found: edit.contrastFound,
        contrast_kept: edit.contrastKept,
      },
      image_error: heroImageError,
    });
  } catch (error) {
    // Revert calendar status on any failure
    await supabase
      .from("content_calendar")
      .update({ status: "approved" })
      .eq("id", calendar_entry_id);

    return NextResponse.json(
      {
        error: `Article writing failed: ${error instanceof Error ? error.message : "unknown error"}`,
      },
      { status: 500 }
    );
  }
}
