/**
 * POST /api/crm/tick — run the workflow engine over all due enrollments.
 * Called by the Cloudflare cron every 5 minutes, the admin "Run engine"
 * button, or the master API key. Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSessionOrApiKey, unauthorizedResponse } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { runEngineTick } from "@/lib/crm/engine";
import { alertTickFailure, recordTickHeartbeat } from "@/lib/crm/tick-watch";

export async function POST(request: NextRequest) {
  const auth = await authenticateSessionOrApiKey(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const supabase = createAdminClient();
  try {
    const summary = await runEngineTick(supabase);
    await recordTickHeartbeat(supabase);
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : "tick failed";
    console.error("crm tick:", message);
    await alertTickFailure(supabase, message);
    return NextResponse.json({ error: "CRM tick failed" }, { status: 500 });
  }
}
