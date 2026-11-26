/** Why a click on Send will be logged instead of delivered. Null when a real send can go out. */
export function deliveryWarning(input: { safeMode: boolean; resendConfigured: boolean }): string | null {
  const reasons: string[] = [];
  if (input.safeMode) reasons.push("Safe mode is on");
  if (!input.resendConfigured) reasons.push("RESEND_API_KEY is not set on the worker");
  if (reasons.length === 0) return null;
  return `${reasons.join(", and ")}. This send is logged on the lead and is not delivered.`;
}
