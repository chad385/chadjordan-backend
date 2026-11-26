import { keyFingerprint } from "../api/signature.ts";
import type { AdminClient } from "./types";

export const CAPTURE_KEY_LIMIT = 30;
export const CAPTURE_IP_LIMIT = 60;
export const CAPTURE_WINDOW_MS = 15 * 60 * 1000;

export interface CaptureBucket {
  fingerprint: string;
  limit: number;
}

export function captureBuckets(keyMaterial: string, ip: string): CaptureBucket[] {
  return [
    { fingerprint: `key:${keyFingerprint(keyMaterial)}`, limit: CAPTURE_KEY_LIMIT },
    { fingerprint: `ip:${keyFingerprint(ip || "unknown")}`, limit: CAPTURE_IP_LIMIT },
  ];
}

export function captureLimitExceeded(count: number, limit: number): boolean {
  return count >= limit;
}

/**
 * Counts recent capture calls for this key and this IP. A missing table
 * (migration 005 not applied yet) fails open so the contact form keeps working,
 * and the error is logged.
 */
export async function enforceCaptureRate(
  supabase: AdminClient,
  buckets: CaptureBucket[],
  now = new Date()
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const since = new Date(now.getTime() - CAPTURE_WINDOW_MS).toISOString();
  for (const bucket of buckets) {
    const { count, error } = await supabase
      .from("capture_rate_events")
      .select("id", { count: "exact", head: true })
      .eq("key_fingerprint", bucket.fingerprint)
      .gte("created_at", since);
    if (error) {
      console.error("capture rate limit unavailable:", error.message);
      return { ok: true };
    }
    if (captureLimitExceeded(count ?? 0, bucket.limit)) {
      return { ok: false, retryAfterSeconds: Math.ceil(CAPTURE_WINDOW_MS / 1000) };
    }
  }

  const { error: insertError } = await supabase.from("capture_rate_events").insert(
    buckets.map((bucket) => ({ key_fingerprint: bucket.fingerprint }))
  );
  if (insertError) {
    console.error("capture rate limit record failed:", insertError.message);
    return { ok: true };
  }

  await supabase
    .from("capture_rate_events")
    .delete()
    .lt("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());

  return { ok: true };
}
