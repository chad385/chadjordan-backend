import type { AdminClient } from "@/lib/crm/types";
import {
  LEAD_STILLS_BUCKET,
  MAX_LEAD_IMAGES,
  leadImageExtension,
  sniffLeadImage,
  type LeadImageType,
} from "@/lib/crm/lead-images";

export interface StoredLeadImage {
  id: string;
  content_type: string;
  byte_size: number;
  filename: string | null;
  created_by: string;
  created_at: string;
}

export async function storeLeadImage(
  supabase: AdminClient,
  input: { leadId: string; bytes: Uint8Array; filename: string | null; createdBy: string }
): Promise<StoredLeadImage> {
  const contentType = sniffLeadImage(input.bytes);
  if (!contentType) {
    throw new Error("Upload a PNG, JPG, or WebP image up to 4 MB");
  }
  const { count, error: countError } = await supabase
    .from("lead_images")
    .select("id", { count: "exact", head: true })
    .eq("lead_id", input.leadId);
  if (countError) throw new Error(countError.message);
  if ((count || 0) >= MAX_LEAD_IMAGES) {
    throw new Error(`This lead already has ${MAX_LEAD_IMAGES} images`);
  }

  const id = crypto.randomUUID();
  const storageKey = `${input.leadId}/${id}.${leadImageExtension(contentType)}`;
  const uploaded = await supabase.storage.from(LEAD_STILLS_BUCKET).upload(storageKey, input.bytes, {
    contentType,
    upsert: false,
  });
  if (uploaded.error) {
    throw new Error(
      uploaded.error.message.includes("Bucket not found") || uploaded.error.message.includes("not found")
        ? "Lead image storage is not ready. Create the private lead-stills bucket by running migration 004."
        : uploaded.error.message
    );
  }

  const { data, error } = await supabase
    .from("lead_images")
    .insert({
      id,
      lead_id: input.leadId,
      storage_key: storageKey,
      content_type: contentType satisfies LeadImageType,
      byte_size: input.bytes.byteLength,
      filename: input.filename,
      created_by: input.createdBy,
    })
    .select("id, content_type, byte_size, filename, created_by, created_at")
    .single();
  if (error || !data) {
    await supabase.storage.from(LEAD_STILLS_BUCKET).remove([storageKey]);
    throw new Error(error?.message || "Image record was not saved");
  }
  return data;
}

export async function readLeadImage(
  supabase: AdminClient,
  leadId: string,
  imageId: string
): Promise<{ bytes: Blob; contentType: string } | null> {
  const { data: row, error } = await supabase
    .from("lead_images")
    .select("storage_key, content_type")
    .eq("id", imageId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;
  const downloaded = await supabase.storage.from(LEAD_STILLS_BUCKET).download(row.storage_key);
  if (downloaded.error || !downloaded.data) return null;
  return { bytes: downloaded.data, contentType: row.content_type };
}
