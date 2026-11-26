import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { MAX_LEAD_IMAGE_BYTES, safeImageFilename } from "@/lib/crm/lead-images";
import { storeLeadImage } from "@/lib/crm/lead-image-store";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id } = await params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("lead_images")
    .select("id, content_type, byte_size, filename, created_by, created_at")
    .eq("lead_id", id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ images: data || [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id } = await params;
  const supabase = createAdminClient();
  const { data: lead, error: lookupError } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_LEAD_IMAGE_BYTES) {
    return NextResponse.json({ error: "Upload a PNG, JPG, or WebP image up to 4 MB" }, { status: 400 });
  }
  try {
    const image = await storeLeadImage(supabase, {
      leadId: id,
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: safeImageFilename(file.name),
      createdBy: "human",
    });
    return NextResponse.json({ image }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image upload failed";
    const status = /not ready|bucket/i.test(message) ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
