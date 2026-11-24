import { BRAND_PROJECTION_KEYS } from "@/lib/brand/playbook-contract";
import { createAdminClient } from "@/lib/supabase/server";

export interface AssistantBrand {
  fullContext: string;
  ctaLinks: string;
  activeOffers: string;
  imageStyle: string;
  imageAvoid: string;
  imageCompositions: string[];
  imageOpener: string;
}

type Admin = ReturnType<typeof createAdminClient>;

/** Live brand_context, including the playbook projection the article writer uses. */
export async function loadAssistantBrand(supabase: Admin): Promise<AssistantBrand> {
  const { data, error } = await supabase.from("brand_context").select("key, category, content").order("category");
  if (error) throw new Error(`Brand context could not be read: ${error.message}`);
  const rows = data || [];
  const missingCore = BRAND_PROJECTION_KEYS.filter(
    (key) => !rows.some((row) => row.key === key && row.content?.trim())
  );
  if (missingCore.length > 0) {
    throw new Error(
      `Brand context is not ready. Missing Playbook projection rows: ${missingCore.join(", ")}.`
    );
  }

  const fullContext = rows
    .map((row) => `# ${row.category}/${row.key}\n\n${row.content}`)
    .join("\n\n---\n\n");
  const ctaLinks = rows.find((row) => row.category === "cta" && row.key === "links")?.content || "";

  const { data: offers, error: offersError } = await supabase
    .from("offers")
    .select("name, tagline, description, price_display, cta_text, cta_url, who_its_for")
    .eq("status", "active")
    .order("position_in_ladder", { ascending: true, nullsFirst: false });
  if (offersError) throw new Error(`Operational offer readiness check failed: ${offersError.message}`);
  const activeOffers = (offers || [])
    .map((offer) =>
      [
        `- ${offer.name}`,
        offer.who_its_for ? `For: ${offer.who_its_for}` : null,
        offer.tagline || offer.description || null,
        offer.price_display ? `Approved price display: ${offer.price_display}` : null,
        offer.cta_text ? `CTA label: ${offer.cta_text}` : null,
        offer.cta_url ? `CTA URL: ${offer.cta_url}` : null,
      ]
        .filter(Boolean)
        .join("\n  ")
    )
    .join("\n");

  const imageStyle = rows.find((row) => row.category === "content" && row.key === "image_style")?.content?.trim() || "";
  const imageAvoid = rows.find((row) => row.category === "content" && row.key === "image_avoid")?.content?.trim() || "";
  const imageCompositions = (rows.find((row) => row.category === "content" && row.key === "image_compositions")?.content || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter((line) => line && !line.startsWith("#"));
  const imageOpener =
    rows.find((row) => row.category === "content" && row.key === "image_opener")?.content?.trim() || "A photograph of";

  return { fullContext, ctaLinks, activeOffers, imageStyle, imageAvoid, imageCompositions, imageOpener };
}
