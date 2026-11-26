import { NextRequest } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { readLeadImage } from "@/lib/crm/lead-image-store";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imageId: string }> }
) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);
  const { id, imageId } = await params;
  try {
    const image = await readLeadImage(createAdminClient(), id, imageId);
    if (!image) return new Response("Not found", { status: 404 });
    return new Response(image.bytes, {
      headers: {
        "Content-Type": image.contentType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image could not be read";
    return new Response(message, { status: 500 });
  }
}
