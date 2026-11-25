import { NextResponse } from "next/server";
import { logActivity } from "@/lib/crm/activity";
import { upsertLead } from "@/lib/crm/leads";
import type { AssistantContext, AssistantOutcome } from "./handle";
import { escapeIlike, listLeadMatches, pickLeadMatch, type LeadCandidate } from "./leads-match";
import { leadIdFromNotesPath, parseResearchNote, researchActivity, type ResearchNote } from "./research-note";
import { organizationalDomains, parseJsonObject, parseLeadRequest, parseLookupRequest, websiteHost } from "./validate";

const LEAD_COLUMNS = "id, email, company";

async function collectCandidates(
  ctx: AssistantContext,
  input: { email?: string; company?: string; domains: string[] }
): Promise<LeadCandidate[]> {
  const found: LeadCandidate[] = [];
  const push = (rows: LeadCandidate[] | null | undefined) => {
    for (const row of rows || []) {
      if (!found.some((item) => item.id === row.id)) found.push(row);
    }
  };

  if (input.email) {
    const { data, error } = await ctx.supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .ilike("email", escapeIlike(input.email))
      .limit(5);
    if (error) throw new Error(error.message);
    push(data);
  }
  if (input.company) {
    const { data, error } = await ctx.supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .ilike("company", escapeIlike(input.company))
      .limit(10);
    if (error) throw new Error(error.message);
    push(data);
  }
  for (const domain of input.domains) {
    const { data, error } = await ctx.supabase
      .from("leads")
      .select(LEAD_COLUMNS)
      .ilike("email", `%@${escapeIlike(domain)}`)
      .limit(10);
    if (error) throw new Error(error.message);
    push(data);
  }
  return found;
}

export async function addAssistantLead(ctx: AssistantContext): Promise<AssistantOutcome> {
  const parsedJson = parseJsonObject(ctx.bodyText);
  if (!parsedJson.ok) return fail(400, parsedJson.error);
  const request = parseLeadRequest(parsedJson.value);
  if (!request.ok) return fail(400, request.error);

  const input = request.value;
  const domains = organizationalDomains({ email: input.email, website: input.website });
  let candidates: LeadCandidate[];
  try {
    candidates = await collectCandidates(ctx, { email: input.email, company: input.company, domains });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : "Lead lookup failed");
  }

  const match = pickLeadMatch({ email: input.email, company: input.company, domains }, candidates);
  const note = [
    input.notes,
    input.website ? `Website: ${websiteHost(input.website) || input.website}` : null,
    match && match.lead.email.toLowerCase() !== input.email ? `Additional email: ${input.email}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    // fireTriggers is false so lead_created / form_submitted / tag workflows do not run.
    // This path does not open a deal and does not enroll a workflow.
    const result = await upsertLead(
      ctx.supabase,
      {
        email: match ? match.lead.email : input.email,
        name: input.name,
        company: input.company,
        source: match ? null : input.source || "assistant",
        message: note || null,
        custom: {
          ...(input.website ? { website: input.website } : {}),
          assistant_source: input.source || "assistant",
        },
      },
      { actor: "assistant", fireTriggers: false }
    );

    let researchNote: { note_id: string; title: string; kind: string } | null = null;
    if (input.research_note) {
      const saved = await saveResearchNote(ctx, result.lead.id, input.research_note);
      if (!saved.ok) {
        return {
          response: NextResponse.json(
            { error: saved.error, lead_id: result.lead.id },
            { status: 500 }
          ),
          targetTable: "leads",
          targetId: result.lead.id,
          error: saved.error,
        };
      }
      researchNote = saved.note;
    }

    return {
      response: NextResponse.json({
        lead_id: result.lead.id,
        created: result.created,
        deduped: Boolean(match) || !result.created,
        matched_on: match?.matched_on ?? (result.created ? null : "email"),
        research_note: researchNote,
        workflow_started: false,
        deal_created: false,
        email_sent: false,
      }),
      targetTable: "leads",
      targetId: result.lead.id,
      metadata: {
        created: result.created,
        matched_on: match?.matched_on ?? null,
        research_note_id: researchNote?.note_id ?? null,
      },
    };
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : "Lead insert failed");
  }
}

export async function lookupAssistantLeads(ctx: AssistantContext): Promise<AssistantOutcome> {
  const request = parseLookupRequest(new URL(ctx.requestUrl).searchParams);
  if (!request.ok) return fail(400, request.error);
  const domains = organizationalDomains(request.value);
  let candidates: LeadCandidate[];
  try {
    candidates = await collectCandidates(ctx, { ...request.value, domains });
  } catch (error) {
    return fail(500, error instanceof Error ? error.message : "Lead lookup failed");
  }
  const matches = listLeadMatches({ ...request.value, domains }, candidates).slice(0, 10);
  return {
    response: NextResponse.json({
      exists: matches.length > 0,
      matches: matches.map((match) => ({
        id: match.lead.id,
        email: match.lead.email,
        company: match.lead.company,
        matched_on: match.matched_on,
      })),
    }),
    metadata: { count: matches.length },
  };
}

export async function addAssistantLeadNote(ctx: AssistantContext): Promise<AssistantOutcome> {
  const leadId = leadIdFromNotesPath(new URL(ctx.requestUrl).pathname);
  if (!leadId) return fail(404, "Lead not found");

  const parsedJson = parseJsonObject(ctx.bodyText);
  if (!parsedJson.ok) return fail(400, parsedJson.error);
  const note = parseResearchNote(parsedJson.value);
  if (!note.ok) return fail(400, note.error);

  const { data: lead, error } = await ctx.supabase.from("leads").select("id").eq("id", leadId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!lead) return fail(404, "Lead not found");

  const saved = await saveResearchNote(ctx, leadId, note.value);
  if (!saved.ok) return fail(500, saved.error);

  return {
    response: NextResponse.json(
      {
        note_id: saved.note.note_id,
        lead_id: leadId,
        title: saved.note.title,
        kind: saved.note.kind,
        actor: "Created by assistant",
        workflow_started: false,
        deal_created: false,
        email_sent: false,
      },
      { status: 201 }
    ),
    targetTable: "lead_activities",
    targetId: saved.note.note_id,
    metadata: { lead_id: leadId, kind: saved.note.kind },
  };
}

async function saveResearchNote(
  ctx: AssistantContext,
  leadId: string,
  note: ResearchNote
): Promise<{ ok: true; note: { note_id: string; title: string; kind: string } } | { ok: false; error: string }> {
  const activity = researchActivity(note);
  const noteId = await logActivity(ctx.supabase, {
    lead_id: leadId,
    activity_type: activity.activity_type,
    title: activity.title,
    body: activity.body,
    data: activity.data,
    actor: activity.actor,
  });
  if (!noteId) return { ok: false, error: "Research note was not saved" };
  return { ok: true, note: { note_id: noteId, title: activity.title, kind: note.kind } };
}

function fail(status: number, error: string): AssistantOutcome {
  return { response: NextResponse.json({ error }, { status }), error };
}
