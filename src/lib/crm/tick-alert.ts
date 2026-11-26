/** One failure mail per six hours, and one heartbeat per UTC day. */
export const TICK_FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const TICK_FAILURE_KEY = "crm_tick_failure_alert_at";
export const TICK_HEARTBEAT_KEY = "crm_tick_heartbeat_on";

export function failureAlertDue(lastIso: string | null | undefined, now: Date): boolean {
  if (!lastIso) return true;
  const then = Date.parse(lastIso);
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= TICK_FAILURE_COOLDOWN_MS;
}

export function heartbeatDue(lastDay: string | null | undefined, now: Date): boolean {
  return lastDay !== now.toISOString().slice(0, 10);
}

export function tickFailureEmail(message: string): { subject: string; body: string } {
  return {
    subject: "CRM engine tick failed",
    body:
      `The CRM cron hit an error and will try again on the next run.\n\n` +
      `${message.slice(0, 500)}\n\n` +
      `This alert is limited to one email every 6 hours.`,
  };
}

export function tickHeartbeatEmail(day: string): { subject: string; body: string } {
  return {
    subject: `CRM engine ran ${day}`,
    body:
      `The CRM engine completed a tick on ${day} (UTC).\n\n` +
      `This note arrives once a day. If it stops, the 5-minute cron has stopped.`,
  };
}
