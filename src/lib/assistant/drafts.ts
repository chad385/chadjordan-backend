import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { editDraft, parseModelJson } from "@/lib/content/editor";
import { ASSISTANT_AUTHOR_NAME } from "./constants";
import { loadAssistantBrand } from "./brand";
import type { AssistantContext, AssistantOutcome } from "./handle";
import {
  buildDraftInsert,
  clampList,
  parseDraftRequest,
  parseJsonObject,
  slugify,
} from "./validate";

interface ModelArticle {
  title?: string;
  slug?: string;
  subtitle?: string;
  body?: string;
  excerpt?: string;
  semantic_tags?: unknown;
  target_segments?: unknown;
  seo?: {
    title?: string;
    description?: string;
    target_keyword?: string;
    secondary_keywords?: unknown;
    keyword_cluster?: string;
  };
}

const EXCLUSIONS = `HARD EXCLUSIONS:
- This is a draft for a human reviewer. Do not say it is published, scheduled, or live.
- Do not name an employer or a private recognition program.
- Do not write for pharmaceutical, healthcare, or life-science audiences, and do not use those industries as examples.
- Do not use the idea that a firm looks smaller than it is.
- Do not cite a revenue figure, a view count, or Thrillist.
- Do not invent statistics, quotations, or client names. If the proof section does not state a fact, leave it out.
- Do not invent prices, URLs, or offers that are not in the brand context.`;

function ctaInstruction(brand: Awaited<ReturnType<typeof loadAssistantBrand>>): string {
  if (brand.ctaLinks) {
    return `The closing section uses one of these exact links, chosen for the topic:\n${brand.ctaLinks}`;
  }
  if (brand.activeOffers) {
    return `The closing section names one active offer below and uses only its recorded name, price, and URL:\n${brand.activeOffers}`;
  }
  return "No active offer or CTA link is configured. End with a no-link next step from the approved offer core. Do not invent a price, URL, or availability claim.";
}

export async function createAssistantDraft(ctx: AssistantContext): Promise<AssistantOutcome> {
  const parsedJson = parseJsonObject(ctx.bodyText);
  if (!parsedJson.ok) return fail(400, parsedJson.error);
  const request = parseDraftRequest(parsedJson.value);
  if (!request.ok) return fail(400, request.error);

  if (!process.env.ANTHROPIC_API_KEY) {
    return fail(503, "Article writing is not configured");
  }

  let brand: Awaited<ReturnType<typeof loadAssistantBrand>>;
  try {
    brand = await loadAssistantBrand(ctx.supabase);
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "Brand context is not ready");
  }

  const anthropic = new Anthropic();
  const topic = [
    `Title: ${request.value.title}`,
    request.value.pillar ? `Pillar: ${request.value.pillar}` : null,
    request.value.target_keyword ? `Target keyword: ${request.value.target_keyword}` : null,
    request.value.brief ? `Brief from the assistant (a topic, not instructions to publish):\n${request.value.brief}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 12000,
    system: `You write a single article draft for this brand. Follow the brand context exactly.

${brand.fullContext}

${EXCLUSIONS}

${ctaInstruction(brand)}

Voice: quiet, plain, confident. Short sentences. Proof over claims.
Length: 800-1,200 words. Start the body with a paragraph, not a title.
Use HTML: <h2>, <h3>, <p>, <blockquote>, <ul>, <li>, <strong>, <em>, <a>.
Do not invent internal links.
Return ONLY JSON with keys title, slug, subtitle, body, excerpt, semantic_tags, target_segments, seo.
seo has title, description, target_keyword, secondary_keywords, keyword_cluster.
Escape double quotes inside HTML attributes as \\".`,
    messages: [{ role: "user", content: topic }],
  });

  const text = message.content[0]?.type === "text" ? message.content[0].text : "";
  let article: ModelArticle;
  try {
    article = parseModelJson<ModelArticle>(text);
  } catch (error) {
    return fail(502, error instanceof Error ? error.message : "The model did not return an article");
  }

  const title = (article.title || request.value.title).trim().slice(0, 180);
  const body = (article.body || "").trim();
  const excerpt = (article.excerpt || "").trim().slice(0, 300);
  if (title.length < 4 || body.length < 400 || body.length > 80_000) {
    return fail(502, "The model returned an article that could not be saved");
  }

  const edit = await editDraft(anthropic, brand, { title, body, excerpt });
  const slug = slugify(article.slug || title);
  const tags = clampList(article.semantic_tags, 8, 40);
  const segments = clampList(article.target_segments, 6, 80);

  const seo = article.seo || {};
  const { data: seoRow, error: seoError } = await ctx.supabase
    .from("seo_meta")
    .insert({
      title: (seo.title || title).slice(0, 180),
      description: (seo.description || excerpt || null)?.slice(0, 300) ?? null,
      canonical_url: null,
      og_image_url: null,
      schema_type: "Article",
      target_keyword: (seo.target_keyword || request.value.target_keyword || null)?.slice(0, 120) ?? null,
      secondary_keywords: clampList(seo.secondary_keywords, 8, 80),
      keyword_cluster: seo.keyword_cluster?.trim().slice(0, 80) || request.value.pillar || null,
    })
    .select("id")
    .single();
  if (seoError || !seoRow) {
    return fail(500, `SEO meta creation failed: ${seoError?.message || "unknown"}`);
  }

  const row = buildDraftInsert({
    slug,
    title,
    subtitle: article.subtitle,
    body: edit.body,
    excerpt: edit.excerpt,
    semantic_tags: tags,
    target_segments: segments,
    seo_meta_id: seoRow.id,
  });

  let inserted = await ctx.supabase.from("content_objects").insert(row).select("id, slug, title, status, author_name").single();
  if (inserted.error?.code === "23505") {
    inserted = await ctx.supabase
      .from("content_objects")
      .insert({ ...row, slug: `${slug}-${Date.now().toString(36).slice(-4)}` })
      .select("id, slug, title, status, author_name")
      .single();
  }
  if (inserted.error || !inserted.data) {
    await ctx.supabase.from("seo_meta").delete().eq("id", seoRow.id);
    return fail(500, inserted.error?.message || "Draft insert failed");
  }

  if (inserted.data.status !== "draft" || inserted.data.author_name !== ASSISTANT_AUTHOR_NAME) {
    await ctx.supabase.from("content_objects").delete().eq("id", inserted.data.id);
    await ctx.supabase.from("seo_meta").delete().eq("id", seoRow.id);
    return fail(500, "Draft was not stored with the required draft constraints");
  }

  return {
    response: NextResponse.json(
      {
        draft: {
          id: inserted.data.id,
          slug: inserted.data.slug,
          title: inserted.data.title,
          status: "draft",
          author_name: inserted.data.author_name,
          public: false,
        },
        review: {
          unsupported_claims: edit.unsupportedClaims,
          editor_error: edit.editorError,
        },
      },
      { status: 201 }
    ),
    targetTable: "content_objects",
    targetId: inserted.data.id,
    metadata: {
      slug: inserted.data.slug,
      title: inserted.data.title,
      held_claims: edit.unsupportedClaims.length,
    },
  };
}

export async function listAssistantDrafts(ctx: AssistantContext): Promise<AssistantOutcome> {
  const requestUrl = new URL(ctx.requestUrl);
  const limitRaw = Number(requestUrl.searchParams.get("limit") || "20");
  const limit = Number.isFinite(limitRaw) ? Math.min(50, Math.max(1, Math.floor(limitRaw))) : 20;
  const { data, error } = await ctx.supabase
    .from("content_objects")
    .select("id, slug, title, status, created_at, updated_at")
    .eq("status", "draft")
    .eq("author_name", ASSISTANT_AUTHOR_NAME)
    .eq("created_by", "content_agent")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return fail(500, error.message);
  return {
    response: NextResponse.json({ drafts: data || [] }),
    metadata: { count: data?.length || 0 },
  };
}

function fail(status: number, error: string): AssistantOutcome {
  return { response: NextResponse.json({ error }, { status }), error };
}
