import type { Json } from "@/types/database";
import { createAdminClient } from "@/lib/supabase/server";
import { ASSISTANT_RATE_LIMIT, ASSISTANT_RATE_WINDOW_SECONDS } from "./constants";

type Admin = ReturnType<typeof createAdminClient>;

export interface AuditEntry {
  keyId: string;
  method: string;
  path: string;
  action: string;
  statusCode: number;
  targetTable?: string | null;
  targetId?: string | null;
  requestBytes?: number;
  error?: string | null;
  metadata?: Record<string, unknown>;
}

export async function auditStoreReady(supabase: Admin): Promise<boolean> {
  const { error } = await supabase.from("assistant_api_audit").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}

export async function countRecentCalls(supabase: Admin, keyId: string, nowMs = Date.now()): Promise<number | null> {
  const since = new Date(nowMs - ASSISTANT_RATE_WINDOW_SECONDS * 1000).toISOString();
  const { count, error } = await supabase
    .from("assistant_api_audit")
    .select("id", { head: true, count: "exact" })
    .eq("key_id", keyId)
    .gte("created_at", since);
  if (error) return null;
  return count || 0;
}

export function rateLimitExceeded(count: number): boolean {
  return count >= ASSISTANT_RATE_LIMIT;
}

export async function writeAudit(supabase: Admin, entry: AuditEntry): Promise<boolean> {
  const { error } = await supabase.from("assistant_api_audit").insert({
    key_id: entry.keyId,
    method: entry.method,
    path: entry.path,
    action: entry.action,
    status_code: entry.statusCode,
    target_table: entry.targetTable ?? null,
    target_id: entry.targetId ?? null,
    request_bytes: entry.requestBytes ?? null,
    error: entry.error ? entry.error.slice(0, 500) : null,
    metadata: (entry.metadata ?? {}) as Json,
  });
  if (error) {
    console.error("assistant audit insert failed", error.message);
    return false;
  }
  return true;
}
