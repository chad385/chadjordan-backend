/**
 * POST /api/unsubscribe?t=<token>
 * One-click unsubscribe (RFC 8058). Mail clients POST here. The human page
 * at /unsubscribe uses the same token. No session: the token is the secret.
 */
import { NextRequest, NextResponse } from "next/server";
import { unsubscribeLead } from "@/lib/crm/unsubscribe";
import { createAdminClient } from "@/lib/supabase/server";

async function tokenFrom(request: NextRequest): Promise<string> {
  const fromQuery = new URL(request.url).searchParams.get("t") || "";
  if (fromQuery) return fromQuery.trim();
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { token?: unknown } | null;
    return typeof body?.token === "string" ? body.token.trim() : "";
  }
  return "";
}

export async function POST(request: NextRequest) {
  const token = await tokenFrom(request);
  const result = await unsubscribeLead(createAdminClient(), token);
  return NextResponse.json(
    result.ok ? { ok: true } : { ok: false, error: result.error || "Could not unsubscribe" },
    { status: result.status }
  );
}
