/**
 * New-lead alerts: the tick emails the owner once for every lead created since
 * the last alert. Off until `crm_new_lead_alerts` is true in backend_settings.
 *
 * Leads can arrive from any door (the frontend form writes straight to
 * `leads`), so this watches the table rather than a capture route. The
 * watermark `crm_new_lead_alert_since` only moves past a lead after its email
 * is sent, so a failed send is retried on the next tick. Switching alerts on
 * starts the watermark at that moment: older leads never alert.
 */
import type { AdminClient } from "./types";

export const NEW_LEAD_ALERTS_KEY = "crm_new_lead_alerts";
export const NEW_LEAD_WATERMARK_KEY = "crm_new_lead_alert_since";
export const NEW_LEAD_ALERT_TITLE = "New-lead alert sent";
const BATCH = 20;

export interface AlertLead {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string | null;
  capture_page: string | null;
  tags: string[] | null;
  created_at: string;
}

export interface AlertDeps {
  /** Emails the owner (notifyOwner in production). */
  notify: (subject: string, bodyMd: string) => Promise<{ sent: boolean; error?: string }>;
  /** Records the alert on the lead's activity trail (logActivity in production). */
  logAlert: (leadId: string) => Promise<void>;
  now?: () => Date;
}

export function newLeadEmail(lead: AlertLead): { subject: string; body: string } {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  const who = name ? `${name} (${lead.email})` : lead.email;
  const where = lead.capture_page || lead.source || "unknown";
  const tags = (lead.tags || []).filter(Boolean).join(", ") || "none";
  return {
    subject: `New lead: ${name || lead.email}`,
    body:
      `**${who}** just came in through your site.\n\n` +
      `Page: ${where} · Source: ${lead.source || "unknown"} · Tags: ${tags}\n\n` +
      `Received: ${lead.created_at}\n\n` +
      `Reply to them directly, or open your Digital Home CRM to see the record.`,
  };
}

async function setSetting(supabase: AdminClient, key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("backend_settings")
    .upsert({ key, value: value as never, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(`save ${key}: ${error.message}`);
}

export async function alertNewLeads(
  supabase: AdminClient,
  deps: AlertDeps
): Promise<{ alerted: number; errors: string[] }> {
  const now = deps.now || (() => new Date());
  const { data: settings } = await supabase
    .from("backend_settings")
    .select("key, value")
    .in("key", [NEW_LEAD_ALERTS_KEY, NEW_LEAD_WATERMARK_KEY]);
  const map = new Map((settings || []).map((row: { key: string; value: unknown }) => [row.key, row.value]));
  if (map.get(NEW_LEAD_ALERTS_KEY) !== true) return { alerted: 0, errors: [] };

  const since = map.get(NEW_LEAD_WATERMARK_KEY);
  if (typeof since !== "string" || Number.isNaN(Date.parse(since))) {
    await setSetting(supabase, NEW_LEAD_WATERMARK_KEY, now().toISOString());
    return { alerted: 0, errors: [] };
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, email, first_name, last_name, source, capture_page, tags, created_at")
    .gt("created_at", since)
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return { alerted: 0, errors: [`new-lead alerts: ${error.message}`] };

  let alerted = 0;
  let watermark = since;
  const errors: string[] = [];
  for (const lead of (leads || []) as AlertLead[]) {
    // Dedupe on the activity trail in case a previous tick sent but failed to
    // save the watermark.
    const { data: already } = await supabase
      .from("lead_activities")
      .select("id")
      .eq("lead_id", lead.id)
      .eq("activity_type", "note")
      .eq("title", NEW_LEAD_ALERT_TITLE)
      .limit(1);
    if (!already?.length) {
      const { subject, body } = newLeadEmail(lead);
      const result = await deps.notify(subject, body);
      if (!result.sent) {
        errors.push(`new-lead alert ${lead.id}: ${result.error || "not sent"}`);
        break; // keep the watermark here so this lead is retried next tick
      }
      await deps.logAlert(lead.id);
      alerted++;
    }
    watermark = lead.created_at;
  }

  if (watermark !== since) await setSetting(supabase, NEW_LEAD_WATERMARK_KEY, watermark);
  return { alerted, errors };
}
