export const LEAD_STILLS_BUCKET = "lead-stills";
export const MAX_LEAD_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_LEAD_IMAGES = 24;

export type LeadImageType = "image/png" | "image/jpeg" | "image/webp";

export function sniffLeadImage(bytes: Uint8Array): LeadImageType | null {
  if (bytes.length < 12 || bytes.length > MAX_LEAD_IMAGE_BYTES) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export function leadImageExtension(type: LeadImageType): "png" | "jpg" | "webp" {
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

export function decodeBase64Image(value: string): Uint8Array | null {
  const trimmed = value.trim().replace(/^data:[^,]+,/, "");
  if (!trimmed || trimmed.length > Math.ceil(MAX_LEAD_IMAGE_BYTES * 4 / 3) + 16) return null;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return null;
  const bytes = Buffer.from(trimmed, "base64");
  if (!bytes.length || bytes.length > MAX_LEAD_IMAGE_BYTES) return null;
  return new Uint8Array(bytes);
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function leadIdFromImagesPath(pathname: string): string | null {
  const match = /^\/api\/assistant\/leads\/([^/]+)\/images$/.exec(pathname);
  if (!match || !UUID.test(match[1])) return null;
  return match[1];
}

export function safeImageFilename(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/[/\\]/g, "").slice(0, 120);
  return cleaned || null;
}
