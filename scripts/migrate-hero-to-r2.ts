/**
 * Moves the existing hero image of one or more posts to the public media
 * bucket, unchanged in content (re-encoded to WebP by the upload route).
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/migrate-hero-to-r2.ts <slug> [<slug>…] [--apply]
 *
 * Without --apply it uploads the copies and prints old -> new URLs. With
 * --apply it also points each post (and its share image) at the new copy and
 * logs the previous URL in agent_logs, so the swap can be reverted. The
 * original file is never deleted. No image model is called.
 */
import { uploadBlogImage } from "./media-upload.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const slugs = args.filter((a) => !a.startsWith("--"));
if (slugs.length === 0) {
  console.error("usage: migrate-hero-to-r2.ts <slug> [<slug>…] [--apply]");
  process.exit(1);
}

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

let failed = 0;
for (const slug of slugs) {
  try {
    const [post] = await rest<Array<{ id: string; title: string; featured_image_url: string | null; seo_meta_id: string | null }>>(
      `content_objects?slug=eq.${encodeURIComponent(slug)}&select=id,title,featured_image_url,seo_meta_id`
    );
    if (!post) throw new Error("not found");
    const oldUrl = post.featured_image_url;
    if (!oldUrl) throw new Error("has no hero image to move");
    if (!oldUrl.includes("/storage/v1/object/public/")) throw new Error(`hero is not on legacy storage: ${oldUrl}`);

    const res = await fetch(oldUrl);
    if (!res.ok) throw new Error(`could not download current hero: HTTP ${res.status}`);
    const saved = await uploadBlogImage(await res.arrayBuffer(), slug);

    console.log(`\n${slug}`);
    console.log(`  old image: ${oldUrl}`);
    console.log(`  new image: ${saved.url} (${saved.bytes} bytes)`);

    if (apply) {
      await rest(`content_objects?id=eq.${post.id}`, { method: "PATCH", body: JSON.stringify({ featured_image_url: saved.url }) });
      if (post.seo_meta_id) {
        await rest(`seo_meta?id=eq.${post.seo_meta_id}`, { method: "PATCH", body: JSON.stringify({ og_image_url: saved.url }) });
      }
      await rest("agent_logs", {
        method: "POST",
        body: JSON.stringify({
          agent: "content_agent",
          action: "migrate_hero",
          description: `Moved hero image to public media: ${post.title}`,
          status: "completed",
          target_table: "content_objects",
          target_id: post.id,
          input_data: { slug, triggered_by: "scripts/migrate-hero-to-r2.ts" },
          output_data: { slug, new_image_url: saved.url, previous_image_url: oldUrl, sha256: saved.sha256 },
        }),
      });
      console.log("  applied: post and share image now use the new copy (old URL logged)");
    }
  } catch (error) {
    failed++;
    console.error(`${slug}: ${error instanceof Error ? error.message : error}`);
  }
}
process.exit(failed ? 1 : 0);
