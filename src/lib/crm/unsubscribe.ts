import { logActivity } from "./activity.ts";
import type { AdminClient } from "./types";

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_BACKEND_ORIGIN = "https://chadjordan-backend.chad-1a0.workers.dev";

export function isUnsubscribeToken(value: string): boolean {
  return TOKEN.test(value);
}

export function backendPublicOrigin(env?: { BACKEND_PUBLIC_URL?: string }): string {
  const configured = env ? env.BACKEND_PUBLIC_URL : process.env.BACKEND_PUBLIC_URL;
  const raw = configured?.trim() || DEFAULT_BACKEND_ORIGIN;
  return raw.replace(/\/$/, "");
}

/** Human confirmation page and the one-click POST URL mail clients call. */
export function unsubscribeLinks(origin: string, token: string): { page: string; oneClick: string } {
  const base = origin.replace(/\/$/, "");
  return {
    page: `${base}/unsubscribe?t=${encodeURIComponent(token)}`,
    oneClick: `${base}/api/unsubscribe?t=${encodeURIComponent(token)}`,
  };
}

export async function unsubscribeLead(
  supabase: AdminClient,
  token: string
): Promise<{ status: number; ok: boolean; error?: string }> {
  if (!isUnsubscribeToken(token)) {
    return { status: 400, ok: false, error: "Invalid unsubscribe link" };
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, email_status")
    .eq("unsubscribe_token", token)
    .maybeSingle();
  if (error) return { status: 500, ok: false, error: "Could not unsubscribe" };
  if (!lead) return { status: 200, ok: true };
  if (lead.email_status === "unsubscribed") return { status: 200, ok: true };

  const { error: updateError } = await supabase
    .from("leads")
    .update({ email_status: "unsubscribed" })
    .eq("id", lead.id);
  if (updateError) return { status: 500, ok: false, error: "Could not unsubscribe" };

  await logActivity(supabase, {
    lead_id: lead.id,
    activity_type: "unsubscribed",
    title: "Unsubscribed",
    actor: "lead",
  });
  return { status: 200, ok: true };
}
