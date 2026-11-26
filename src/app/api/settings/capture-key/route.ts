/**
 * GET /api/settings/capture-key — admin-only reveal of the capture key.
 * The ordinary settings payload returns a masked copy.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", "crm_capture_key")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const captureKey = typeof data?.value === "string" ? data.value : "";
  if (!captureKey) return NextResponse.json({ error: "No capture key is set" }, { status: 404 });
  return NextResponse.json({ capture_key: captureKey });
}
