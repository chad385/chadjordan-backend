import { notifyOwner } from "./email";
import {
  failureAlertDue,
  heartbeatDue,
  TICK_FAILURE_KEY,
  TICK_HEARTBEAT_KEY,
  tickFailureEmail,
  tickHeartbeatEmail,
} from "./tick-alert";
import type { AdminClient } from "./types";

async function readSetting(supabase: AdminClient, key: string): Promise<unknown> {
  const { data } = await supabase.from("backend_settings").select("value").eq("key", key).maybeSingle();
  return data?.value;
}

async function writeSetting(supabase: AdminClient, key: string, value: unknown): Promise<void> {
  const { error } = await supabase
    .from("backend_settings")
    .upsert({ key, value: value as never, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

const HEARTBEAT_ATTEMPT_KEY = "crm_tick_heartbeat_attempt_at";

/** Emails Chad when a tick throws. At most once every six hours, including when the mail itself fails. Never throws. */
export async function alertTickFailure(supabase: AdminClient, message: string, now = new Date()): Promise<void> {
  try {
    const last = await readSetting(supabase, TICK_FAILURE_KEY);
    if (!failureAlertDue(typeof last === "string" ? last : null, now)) return;
    await writeSetting(supabase, TICK_FAILURE_KEY, now.toISOString());
    const mail = tickFailureEmail(message);
    const sent = await notifyOwner(supabase, mail.subject, mail.body);
    if (!sent.sent) console.error("tick failure alert not sent:", sent.error || "not sent");
  } catch (e) {
    console.error("tick failure alert:", e instanceof Error ? e.message : String(e));
  }
}

/** One "the engine ran" note per UTC day after a successful tick. A failed send waits six hours. Never throws. */
export async function recordTickHeartbeat(supabase: AdminClient, now = new Date()): Promise<void> {
  try {
    const last = await readSetting(supabase, TICK_HEARTBEAT_KEY);
    if (!heartbeatDue(typeof last === "string" ? last : null, now)) return;
    const attempt = await readSetting(supabase, HEARTBEAT_ATTEMPT_KEY);
    if (!failureAlertDue(typeof attempt === "string" ? attempt : null, now)) return;
    await writeSetting(supabase, HEARTBEAT_ATTEMPT_KEY, now.toISOString());
    const day = now.toISOString().slice(0, 10);
    const mail = tickHeartbeatEmail(day);
    const sent = await notifyOwner(supabase, mail.subject, mail.body);
    if (!sent.sent) {
      console.error("tick heartbeat not sent:", sent.error || "not sent");
      return;
    }
    await writeSetting(supabase, TICK_HEARTBEAT_KEY, day);
  } catch (e) {
    console.error("tick heartbeat:", e instanceof Error ? e.message : String(e));
  }
}
