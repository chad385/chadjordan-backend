import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  buildImagePrompt,
  composeSubject,
  describeOpenAIError,
  htmlToText,
  pickFraming,
  pickImageSubject,
  renderImage,
} from "@/lib/content/image";
import { savePublicImage } from "@/lib/media/public-media";
import { mediaEnvironment } from "@/lib/media/runtime";
import { loadAssistantBrand } from "./brand";
import type { AssistantContext, AssistantOutcome } from "./handle";
import { imageAttachmentPatch, parseImageRequest, parseJsonObject, shouldAttachImage, slugify } from "./validate";

export async function createAssistantImage(ctx: AssistantContext): Promise<AssistantOutcome> {
  const parsedJson = parseJsonObject(ctx.bodyText);
  if (!parsedJson.ok) return fail(400, parsedJson.error);
  const request = parseImageRequest(parsedJson.value);
  if (!request.ok) return fail(400, request.error);
  if (!process.env.OPENAI_API_KEY) return fail(503, "Image generation is not configured");

  let draft: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    body: string | null;
    status: string;
  } | null = null;

  if (request.value.draft_id) {
    const { data, error } = await ctx.supabase
      .from("content_objects")
      .select("id, slug, title, excerpt, body, status")
      .eq("id", request.value.draft_id)
      .maybeSingle();
    if (error) return fail(500, error.message);
    if (!data) return fail(404, "Draft not found");
    draft = data;
  }

  let brand: Awaited<ReturnType<typeof loadAssistantBrand>>;
  try {
    brand = await loadAssistantBrand(ctx.supabase);
  } catch (error) {
    return fail(503, error instanceof Error ? error.message : "Brand context is not ready");
  }

  let subject = request.value.prompt?.trim() || "";
  let framing = "";
  try {
    if (!subject) {
      if (!draft?.body && !draft?.title) return fail(400, "prompt is required when the draft has no text");
      const anthropic = new Anthropic();
      if (!process.env.ANTHROPIC_API_KEY) return fail(503, "Choosing an image subject needs the Anthropic key, or send a prompt");
      const picked = await pickImageSubject(anthropic, {
        title: draft?.title || "Draft",
        excerpt: draft?.excerpt || "",
        bodyText: htmlToText(draft?.body || ""),
        imageStyle: brand.imageStyle,
        opener: brand.imageOpener,
        recent: [],
      });
      subject = composeSubject(brand.imageOpener, picked.concept || draft?.title || "a quiet working interior");
    }
    const seed = draft?.slug || slugify(subject).slice(0, 40);
    framing = pickFraming(seed, brand.imageCompositions, []);
    const bytes = await renderImage(
      new OpenAI(),
      process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      buildImagePrompt({ subject, framing, imageStyle: brand.imageStyle, imageAvoid: brand.imageAvoid }),
      "webp"
    );
    const saved = await savePublicImage(mediaEnvironment(), bytes, seed, ctx.origin);
    const attach = shouldAttachImage(draft?.status, request.value.attach && Boolean(draft));
    let attached = false;
    if (attach && draft) {
      const patch = imageAttachmentPatch(saved.url);
      const { data: updated, error: updateError } = await ctx.supabase
        .from("content_objects")
        .update(patch)
        .eq("id", draft.id)
        .eq("status", "draft")
        .select("id, status")
        .maybeSingle();
      if (updateError) return fail(500, updateError.message);
      attached = Boolean(updated && updated.status === "draft");
    }

    return {
      response: NextResponse.json({
        url: saved.url,
        draft_id: draft?.id ?? null,
        attached,
        published: false,
      }),
      targetTable: attached ? "content_objects" : null,
      targetId: attached ? draft?.id : null,
      metadata: { attached, draft_id: draft?.id ?? null },
    };
  } catch (error) {
    const message = describeOpenAIError(error).replace(/\s*\(OpenAI org:[^)]*\)$/, "");
    const unavailable = /not connected|not configured|unavailable|IMAGES binding|OPENAI_API_KEY/i.test(message);
    return fail(unavailable ? 503 : 502, message);
  }
}

function fail(status: number, error: string): AssistantOutcome {
  return { response: NextResponse.json({ error }, { status }), error };
}
