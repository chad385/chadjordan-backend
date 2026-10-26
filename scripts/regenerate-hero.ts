/**
 * Regenerates the hero image for one or more existing posts, using the same
 * subject picker, variety check, framing, and Visual DNA as the article writer.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/regenerate-hero.ts <slug> [<slug>…] [--apply]
 *
 * Slugs run in order, and each one sees the subjects picked before it, so a
 * batch comes out varied. Without --apply it only generates and uploads the new
 * images and prints their URLs. With --apply it also points each post (and its
 * share image) at the new file and logs the old URL, so a swap can be reverted.
 * Old images are never deleted. New images go to the public media bucket
 * through the backend's signed upload (needs API_SECRET_KEY).
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import {
  buildImagePrompt,
  composeSubject,
  htmlToText,
  pickFraming,
  pickImageSubject,
  renderImage,
} from "../src/lib/content/image.ts";
import { uploadBlogImage } from "./media-upload.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const slugs = args.filter((a) => !a.startsWith("--"));
if (slugs.length === 0) {
  console.error("usage: regenerate-hero.ts <slug> [<slug>…] [--apply]");
  process.exit(1);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, Prefer: "return=representation", ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`${init.method || "GET"} ${path}: HTTP ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : []) as T;
}

const brandRows = await rest<Array<{ key: string; category: string; content: string }>>(
  "brand_context?select=key,category,content&category=eq.content"
);
const cfg = (key: string) => brandRows.find((r) => r.key === key)?.content?.trim() || "";
const imageStyle = cfg("image_style");
const imageAvoid = cfg("image_avoid");
const opener = cfg("image_opener") || "A photograph of";
const compositions = cfg("image_compositions")
  .split("\n")
  .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
  .filter((l) => l && !l.startsWith("#"));

const logs = await rest<Array<{ output_data: { image?: { subject?: string; framing?: string; error?: string | null } } | null }>>(
  "agent_logs?select=output_data&action=in.(write_article,regenerate_hero)&order=created_at.desc&limit=40"
);
const recent: string[] = [];
const recentFramings: string[] = [];
for (const l of logs) {
  const img = l.output_data?.image;
  if (!img?.subject || img.error || recent.includes(img.subject)) continue;
  recent.push(img.subject);
  if (img.framing) recentFramings.push(img.framing);
}

const anthropic = new Anthropic();
const openai = new OpenAI();

for (const slug of slugs) {
  const [post] = await rest<
    Array<{ id: string; title: string; excerpt: string | null; body: string | null; featured_image_url: string | null; seo_meta_id: string | null }>
  >(`content_objects?slug=eq.${encodeURIComponent(slug)}&select=id,title,excerpt,body,featured_image_url,seo_meta_id`);
  if (!post) {
    console.error(`${slug}: not found`);
    continue;
  }

  const pick = await pickImageSubject(anthropic, {
    title: post.title,
    excerpt: post.excerpt || "",
    bodyText: htmlToText(post.body || ""),
    imageStyle,
    opener,
    recent: recent.slice(0, 8),
  });
  const subject = composeSubject(opener, pick.concept);
  const framing = pickFraming(slug, compositions, recentFramings);
  const image = await renderImage(openai, MODEL, buildImagePrompt({ subject, framing, imageStyle, imageAvoid }), "webp");
  const { url: newUrl } = await uploadBlogImage(image, slug);

  console.log(`\n${slug}`);
  console.log(`  subject: ${subject}`);
  console.log(`  framing: ${framing}`);
  if (pick.rejected.length) for (const r of pick.rejected) console.log(`  rejected: ${r.concept} — ${r.reason}`);
  if (pick.stillRepeats) console.log(`  WARNING still repeats: ${pick.stillRepeats}`);
  console.log(`  new image: ${newUrl}`);
  console.log(`  old image: ${post.featured_image_url}`);

  recent.unshift(subject);
  recentFramings.unshift(framing);

  if (apply) {
    await rest(`content_objects?id=eq.${post.id}`, { method: "PATCH", body: JSON.stringify({ featured_image_url: newUrl }) });
    if (post.seo_meta_id) {
      await rest(`seo_meta?id=eq.${post.seo_meta_id}`, { method: "PATCH", body: JSON.stringify({ og_image_url: newUrl }) });
    }
    await rest("agent_logs", {
      method: "POST",
      body: JSON.stringify({
        agent: "content_agent",
        action: "regenerate_hero",
        description: `Regenerated hero image: ${post.title}`,
        status: "completed",
        target_table: "content_objects",
        target_id: post.id,
        input_data: { slug, triggered_by: "scripts/regenerate-hero.ts" },
        output_data: {
          slug,
          image: { subject, framing, error: null, subject_attempts: pick.attempts, rejected_subjects: pick.rejected },
          new_image_url: newUrl,
          previous_image_url: post.featured_image_url,
        },
      }),
    });
    console.log("  applied: post and share image now use the new file (old URL logged)");
  }
}
