/**
 * Shared helpers for operator scripts that put article images in the public
 * media bucket. Uploads go through the backend's signed POST /api/media/upload,
 * so images are optimised to WebP and land where the publish guard expects.
 *
 * Needs API_SECRET_KEY in the environment. BACKEND_URL overrides the default.
 */
import { createHmac } from "node:crypto";

export const BACKEND_URL = (process.env.BACKEND_URL || "https://chadjordan-backend.chad-1a0.workers.dev").replace(/\/$/, "");

export async function signedPost<T>(path: string, payload: unknown): Promise<T> {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) throw new Error("API_SECRET_KEY is not set");
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret).update(`POST:${path}:${timestamp}:${body}`).digest("hex");
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": secret, "x-timestamp": timestamp, "x-signature": signature },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

/** Uploads image bytes as a blog hero and returns its public media URL. */
export async function uploadBlogImage(bytes: ArrayBuffer, slug: string): Promise<{ url: string; bytes: number; sha256: string }> {
  const image_base64 = Buffer.from(bytes).toString("base64");
  const saved = await signedPost<{ success: boolean; url: string; bytes: number; sha256: string }>(
    "/api/media/upload",
    { image_base64, slug, kind: "blog" }
  );
  if (!saved.success || !saved.url) throw new Error(`${slug}: upload returned no URL`);
  // Confirm the public copy actually serves before anyone points a post at it.
  const check = await fetch(saved.url, { method: "HEAD" });
  if (!check.ok || check.headers.get("content-type") !== "image/webp") {
    throw new Error(`${slug}: uploaded image does not serve correctly (HTTP ${check.status})`);
  }
  return saved;
}
