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
import { mediaBase, mediaBucket, savePublicImage } from "@/lib/media/public-media";
import { mediaEnvironment } from "@/lib/media/runtime";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { findContrasts, type ContrastHit } from "@/lib/content/contrast";
import { editDraft, parseModelJson } from "@/lib/content/editor";
import {
  buildImagePrompt,
  composeSubject,
  describeOpenAIError,
  htmlToText,
  pickFraming,
  pickImageSubject,
  renderImage,
} from "@/lib/content/image";
import { BRAND_PROJECTION_KEYS } from "@/lib/brand/playbook-contract";


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
  activeOffers: string;
  authorName: string;
  imageStyle: string;
  imageAvoid: string;
  imageCompositions: string[];
  imageOpener: string;
  imageMode: "automatic" | "text_only";
}

async function loadBrandContext(): Promise<BrandContext> {
  const supabase = createAdminClient();

  const { data: dbContext } = await supabase
    .from("brand_context")
    .select("key, category, content")
    .order("category");

  const rows = dbContext || [];

  const missingCore = BRAND_PROJECTION_KEYS.filter(
    (key) => !rows.some((row) => row.key === key && row.content?.trim())
  );
  if (missingCore.length > 0) {
    throw new Error(
      `Brand context is not ready for article writing. Missing Playbook projection rows: ${missingCore.join(", ")}. ` +
        "Run the scoped Brand Playbook publisher sync before writing."
    );
  }

  const fullContext = rows
    .map((row) => `# ${row.category}/${row.key}\n\n${row.content}`)
    .join("\n\n---\n\n");

  // Extract CTA links from brand context (category: "cta", key: "links")
  const ctaRow = rows.find((r) => r.category === "cta" && r.key === "links");
  const ctaLinks = ctaRow?.content || "";

  const { data: offers, error: offersError } = await supabase
    .from("offers")
    .select("name, tagline, description, price_display, cta_text, cta_url, who_its_for")
    .eq("status", "active")
    .order("position_in_ladder", { ascending: true, nullsFirst: false });
  if (offersError) throw new Error(`Operational offer readiness check failed: ${offersError.message}`);
  const activeOffers = (offers || []).map((offer) => [
    `- ${offer.name}`,
    offer.who_its_for ? `For: ${offer.who_its_for}` : null,
    offer.tagline || offer.description || null,
    offer.price_display ? `Approved price display: ${offer.price_display}` : null,
    offer.cta_text ? `CTA label: ${offer.cta_text}` : null,
    offer.cta_url ? `CTA URL: ${offer.cta_url}` : null,
  ].filter(Boolean).join("\n  ")).join("\n");

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

  //   image_opener → the words every image prompt starts with, completed by
  //   the article's own subject (e.g. "Stills archive of a")
  const openerRow = rows.find((r) => r.category === "content" && r.key === "image_opener");
  const imageOpener = openerRow?.content?.trim() || "A photograph of";


  const imageModeRow = rows.find((r) => r.category === "content" && r.key === "article_image_mode");
  const imageMode = imageModeRow?.content?.trim();
  if (imageMode !== "automatic" && imageMode !== "text_only") throw new Error("Article imagery preference is not configured. Simon must record automatic or text_only before writing.");
  return { fullContext, ctaLinks, activeOffers, authorName, imageStyle, imageAvoid, imageCompositions, imageOpener, imageMode };
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

// ─── Hero image ──────────────────────────────────────────────────────────────

const RECENT_SUBJECTS = 8;

/** Subjects and framings of the most recent hero images (newest first), from the agent log. */
async function recentImages(): Promise<{ subjects: string[]; framings: string[] }> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("agent_logs")
    .select("output_data")
    .in("action", ["write_article", "regenerate_hero"])
    .order("created_at", { ascending: false })
    .limit(40);
  const subjects: string[] = [];
  const framings: string[] = [];
  for (const row of data || []) {
    const image = (row.output_data as { image?: { subject?: string; framing?: string; error?: string | null } } | null)?.image;
    if (!image?.subject || image.error || subjects.includes(image.subject)) continue;
    subjects.push(image.subject);
    if (image.framing) framings.push(image.framing);
    if (subjects.length >= RECENT_SUBJECTS) break;
  }
  return { subjects, framings };
}

/**
 * Saves the hero to the public media bucket (2.9.0). The image is optimised to
 * WebP and named by its content digest, so no article can overwrite another's.
 */
async function uploadHero(slug: string, image: ArrayBuffer, backendOrigin: string): Promise<string> {
  const saved = await savePublicImage(mediaEnvironment(), image, slug, backendOrigin);
  return saved.url;
}

// ─── Contrast check (code, not model) ────────────────────────────────────────

const MAX_CONTRASTS = 1;
const MAX_CONTRAST_REWRITES = 2;

/** Count contrasts in the article text only — the FAQ isn't part of the argument. */
function articleContrasts(body: string): ContrastHit[] {
  const main = body.split(/<h2[^>]*>\s*Frequently Asked Questions/i)[0];
  return findContrasts(main);
}

/**
 * Hand the model the exact sentences the code flagged and ask for direct
 * rewrites of all but one. Sentences flagged as client claims are frozen so
 * the reviewer still sees them unchanged.
 */
async function rewriteContrasts(
  anthropic: Anthropic,
  body: string,
  hits: ContrastHit[],
  frozen: string[]
): Promise<string> {
  const list = hits.map((h, i) => `${i + 1}. ${h.sentence}`).join("\n");
  const frozenList = frozen.length
    ? `\nDo NOT change these sentences, even if listed above:\n${frozen.map((f) => `- ${f}`).join("\n")}\n`
    : "";
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    system: `You are a line editor. The listed sentences each set something up only to deny it or contrast it ("look newer, not more established", "not to list services, but to give…", "rather than", "It isn't A. It's B."). Keep at most ONE of them unchanged (the strongest). Rewrite every other one so it states the positive point directly, with no "not", "rather than", or "instead of" contrast. Change nothing else in the body: same facts, links, headings, HTML, and FAQ. Return ONLY JSON: {"body": "the full edited HTML body"}, with double quotes inside HTML attributes escaped as \\".`,
    messages: [{ role: "user", content: `Sentences to fix:\n${list}\n${frozenList}\nBody (HTML):\n${body}` }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const out = parseModelJson<{ body?: string }>(text);
  if (!out.body || out.body.length < body.length * 0.5) {
    throw new Error("Contrast rewrite returned an empty or truncated body");
  }
  return out.body;
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
  const targetStatus: "published" | "draft" = publishMode === "autonomous" ? "published" : "draft";

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


    if (brand.imageMode === "automatic") {
      mediaBucket(mediaEnvironment());
      mediaBase(mediaEnvironment(), request.nextUrl.origin);
      if (!mediaEnvironment().IMAGES) throw new Error("Image optimisation is not configured");
      if (!process.env.OPENAI_API_KEY) throw new Error("Automatic imagery needs the saved OpenAI key");
    }

    const internalLinks = publishedArticles.length > 0
      ? `\n\nExisting articles for internal linking (use these exact paths — they are the canonical URLs):\n${publishedArticles
          .map((a) => `- ${a.path} — "${a.title}"`)
          .join("\n")}`
      : "";

    // Build CTA instruction from brand context
    const ctaInstruction = brand.ctaLinks
      ? `- The CTA section MUST include one of the links below (choose the most relevant for the article topic). Use ONLY these exact links — do not modify the URLs or create new ones:\n${brand.ctaLinks}`
      : brand.activeOffers
        ? `- Match the CTA to one active operational offer below. Use only its recorded name, price, status and URL; omit any field that is absent and never infer it:\n${brand.activeOffers}`
        : "- No active operational offer or configured CTA link exists. End with a non-transactional, no-link next step grounded in the approved offer core. Do not invent a price, URL, checkout destination, testimonial, active status, or availability claim. This draft requires CTA readiness review before publication.";

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

    // 6c. Contrast check in code. The editor's own count isn't trusted.
    let contrasts = articleContrasts(articleData.body);
    const contrastsAfterEditor = contrasts.length;
    let contrastRewrites = 0;
    let contrastRewriteError: string | null = null;
    while (contrasts.length > MAX_CONTRASTS && contrastRewrites < MAX_CONTRAST_REWRITES) {
      contrastRewrites++;
      try {
        articleData.body = await rewriteContrasts(
          anthropic,
          articleData.body,
          contrasts,
          edit.unsupportedClaims.map((c) => c.sentence)
        );
      } catch (err) {
        contrastRewriteError = err instanceof Error ? err.message : "unknown error";
        console.error("Contrast rewrite failed:", err);
        break;
      }
      contrasts = articleContrasts(articleData.body);
    }
    const contrastReport = {
      editor_self_report: edit.contrastKept,
      after_editor: contrastsAfterEditor,
      final: contrasts.length,
      rewrites: contrastRewrites,
      remaining: contrasts.map((c) => c.sentence),
      rewrite_error: contrastRewriteError,
    };

    const holdReasons: string[] = [];
    if (edit.editorError) {
      holdReasons.push(`[HELD: editing pass failed (${edit.editorError}) — review before publishing]`);
    }
    if (edit.unsupportedClaims.length > 0) {
      holdReasons.push(
        `[HELD: unsupported client claims — do not publish until checked]\n${edit.unsupportedClaims
          .map((c) => `• "${c.sentence}" — ${c.reason}`)
          .join("\n")}`
      );
    }
    if (contrasts.length > MAX_CONTRASTS) {
      holdReasons.push(
        `[HELD: style — ${contrasts.length} "not X, it's Y" sentences remain (limit ${MAX_CONTRASTS})]\n${contrasts
          .map((c) => `• "${c.sentence}"`)
          .join("\n")}`
      );
    }
    // held/finalStatus are settled after the hero image: a failed image also holds the draft.

    // 7. Generate hero image. A failure keeps the paid copy but holds it as a
    // draft (2.9.0 publication guard). text_only mode skips the image call.
    // Subject from the article, checked in code against recent images so the
    // site's thumbnails don't all show the same scene.
    let heroImageUrl: string | null = null;
    let subject = "";
    let framing = "";
    let imageError: string | null = null;
    let subjectPick: Awaited<ReturnType<typeof pickImageSubject>> | null = null;
    if (brand.imageMode === "automatic") try {
      const recent = await recentImages();
      subjectPick = await pickImageSubject(anthropic, {
        title: articleData.title,
        excerpt: articleData.excerpt,
        bodyText: htmlToText(articleData.body),
        imageStyle: brand.imageStyle,
        opener: brand.imageOpener,
        recent: recent.subjects,
      });
      subject = composeSubject(
        brand.imageOpener,
        subjectPick.concept || `real, ordinary scene connected to "${entry.target_keyword || articleData.title}"`
      );
      framing = pickFraming(articleData.slug, brand.imageCompositions, recent.framings);
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
      const image = await renderImage(
        new OpenAI(),
        OPENAI_IMAGE_MODEL,
        buildImagePrompt({ subject, framing, imageStyle: brand.imageStyle, imageAvoid: brand.imageAvoid }),
        "webp"
      );
      heroImageUrl = await uploadHero(articleData.slug, image, request.nextUrl.origin);
    } catch (err) {
      console.error("Hero image generation failed:", err);
      imageError = describeOpenAIError(err);
    }
    if (imageError) {
      holdReasons.push(`[HELD: hero image failed (${imageError}) — repair the image before publishing]`);
    }
    const held = holdReasons.length > 0;
    const finalStatus = held ? "draft" : targetStatus;
    // One "[HELD" prefix so the content board recognises it; reasons follow.
    const holdNote = held
      ? holdReasons.map((r, i) => (i === 0 ? r : r.replace(/^\[HELD: /, "["))).join("\n")
      : null;
    const imageReport = {
      mode: brand.imageMode,
      subject,
      framing,
      error: imageError,
      subject_attempts: subjectPick?.attempts ?? 0,
      rejected_subjects: subjectPick?.rejected ?? [],
      still_repeats: subjectPick?.stillRepeats ?? null,
    };

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
          contrast: contrastReport,
          image: imageReport,
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
        contrast: contrastReport,
      },
      image: imageReport,
      image_status: imageError ? "failed" : brand.imageMode === "text_only" ? "text_only" : "ready",
      image_error: imageError,
      publication_blocked: Boolean(imageError),
      content_object_id: articleResult?.id,
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
