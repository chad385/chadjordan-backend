import type { AdminClient } from "./types";
import type { Json } from "@/types/database";

export interface ActivityInput {
  lead_id: string;
  activity_type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
  actor?: string; // human | system | agent:<name>
}

export async function logActivity(supabase: AdminClient, input: ActivityInput): Promise<string | null> {
  const { data, error } = await supabase
    .from("lead_activities")
    .insert({
      lead_id: input.lead_id,
      activity_type: input.activity_type,
      title: input.title,
      body: input.body ?? null,
      data: (input.data ?? {}) as Json,
      actor: input.actor ?? "system",
    })
    .select("id")
    .single();
  if (error || !data) console.warn("logActivity failed:", error?.message);

  await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", input.lead_id);

  return data?.id ?? null;
}
