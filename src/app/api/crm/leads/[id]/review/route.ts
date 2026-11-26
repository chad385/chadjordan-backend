/**
 * POST /api/crm/leads/[id]/review
 * Records Chad's review. Does not send email, enroll a workflow, or open a deal.
 */
import { NextRequest, NextResponse } from "next/server";
import { authenticateSession, unauthorizedResponse } from "@/lib/api/auth";
import { logActivity } from "@/lib/crm/activity";
import { parseReviewUpdate, REVIEW_LABELS } from "@/lib/crm/review";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSession(request);
  if (!auth.authenticated) return unauthorizedResponse(auth.error);

  const { id } = await params;
  const parsed = parseReviewUpdate(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createAdminClient();
  const { data: lead, error: lookupError } = await supabase.from("leads").select("id").eq("id", id).maybeSingle();
  if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const reviewedAt = parsed.status === "not_reviewed" ? null : new Date().toISOString();
  const { data: updated, error } = await supabase
    .from("leads")
    .update({
      review_status: parsed.status,
      review_comment: parsed.comment,
      reviewed_at: reviewedAt,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json({ error: error?.message || "Review was not saved" }, { status: 500 });
  }

  await logActivity(supabase, {
    lead_id: id,
    activity_type: "review",
    title: `Review: ${REVIEW_LABELS[parsed.status]}`,
    body: parsed.comment,
    data: { review_status: parsed.status },
    actor: "human",
  });

  return NextResponse.json({
    lead: updated,
    email_sent: false,
    workflow_started: false,
    deal_created: false,
  });
}
