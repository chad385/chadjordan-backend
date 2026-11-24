import { ASSISTANT_AUTHOR_NAME } from "./constants.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const BLOCKED_MUTATION_FIELDS = [
  "status",
  "publish_mode",
  "publish",
  "scheduled_publish_date",
  "scheduled_at",
  "published_at",
  "author_name",
  "created_by",
  "autonomous",
  "calendar_entry_id",
  "workflow_id",
  "enroll",
  "create_deal",
  "opportunity",
] as const;

export function parseJsonObject(text: string): Parsed<Record<string, unknown>> {
  if (!text.trim()) return { ok: false, error: "JSON body is required" };
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "JSON body must be an object" };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }
}

function rejectBlocked(body: Record<string, unknown>): string | null {
  const present = BLOCKED_MUTATION_FIELDS.filter((key) => Object.prototype.hasOwnProperty.call(body, key));
  if (present.length === 0) return null;
  return `These fields are not accepted: ${present.join(", ")}`;
}

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): string | null {
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length === 0) return null;
  return `Unknown fields: ${extra.join(", ")}`;
}

function optionalString(value: unknown, field: string, max: number): Parsed<string | undefined> {
  if (value === undefined || value === null || value === "") return { ok: true, value: undefined };
  if (typeof value !== "string") return { ok: false, error: `${field} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (trimmed.length > max) return { ok: false, error: `${field} must be at most ${max} characters` };
  return { ok: true, value: trimmed };
}

function requiredString(value: unknown, field: string, min: number, max: number): Parsed<string> {
  const parsed = optionalString(value, field, max);
  if (!parsed.ok) return parsed;
  if (!parsed.value || parsed.value.length < min) {
    return { ok: false, error: `${field} must be ${min}-${max} characters` };
  }
  return { ok: true, value: parsed.value };
}

export interface DraftRequest {
  title: string;
  brief?: string;
  target_keyword?: string;
  pillar?: string;
}

export function parseDraftRequest(body: Record<string, unknown>): Parsed<DraftRequest> {
  const blocked = rejectBlocked(body);
  if (blocked) return { ok: false, error: blocked };
  const unknown = unknownKeys(body, ["title", "brief", "target_keyword", "pillar"]);
  if (unknown) return { ok: false, error: unknown };

  const title = requiredString(body.title, "title", 4, 180);
  if (!title.ok) return title;
  const brief = optionalString(body.brief, "brief", 4000);
  if (!brief.ok) return brief;
  const target_keyword = optionalString(body.target_keyword, "target_keyword", 120);
  if (!target_keyword.ok) return target_keyword;
  const pillar = optionalString(body.pillar, "pillar", 160);
  if (!pillar.ok) return pillar;

  return {
    ok: true,
    value: {
      title: title.value,
      brief: brief.value,
      target_keyword: target_keyword.value,
      pillar: pillar.value,
    },
  };
}

export interface ImageRequest {
  draft_id?: string;
  prompt?: string;
  attach: boolean;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function parseImageRequest(body: Record<string, unknown>): Parsed<ImageRequest> {
  const blocked = rejectBlocked(body);
  if (blocked) return { ok: false, error: blocked };
  const unknown = unknownKeys(body, ["draft_id", "prompt", "attach"]);
  if (unknown) return { ok: false, error: unknown };

  let draft_id: string | undefined;
  if (body.draft_id !== undefined && body.draft_id !== null && body.draft_id !== "") {
    if (typeof body.draft_id !== "string" || !UUID.test(body.draft_id)) {
      return { ok: false, error: "draft_id must be a UUID" };
    }
    draft_id = body.draft_id;
  }
  const prompt = optionalString(body.prompt, "prompt", 2000);
  if (!prompt.ok) return prompt;
  if (!draft_id && !prompt.value) {
    return { ok: false, error: "draft_id or prompt is required" };
  }
  if (body.attach !== undefined && typeof body.attach !== "boolean") {
    return { ok: false, error: "attach must be a boolean" };
  }

  return {
    ok: true,
    value: {
      draft_id,
      prompt: prompt.value,
      attach: body.attach !== false,
    },
  };
}

export interface LeadRequest {
  name: string;
  company?: string;
  email: string;
  website?: string;
  source?: string;
  notes?: string;
}

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

export function parseLeadRequest(body: Record<string, unknown>): Parsed<LeadRequest> {
  const blocked = rejectBlocked(body);
  if (blocked) return { ok: false, error: blocked };
  const unknown = unknownKeys(body, ["name", "company", "email", "website", "source", "notes"]);
  if (unknown) return { ok: false, error: unknown };

  const name = requiredString(body.name, "name", 1, 160);
  if (!name.ok) return name;
  const company = optionalString(body.company, "company", 160);
  if (!company.ok) return company;
  const emailRaw = optionalString(body.email, "email", 254);
  if (!emailRaw.ok) return emailRaw;
  if (!emailRaw.value || !isEmail(emailRaw.value.toLowerCase())) {
    return { ok: false, error: "Valid email is required" };
  }
  const website = optionalString(body.website, "website", 300);
  if (!website.ok) return website;
  if (website.value && !websiteHost(website.value)) {
    return { ok: false, error: "website must be a host or http(s) URL" };
  }
  const source = optionalString(body.source, "source", 80);
  if (!source.ok) return source;
  const notes = optionalString(body.notes, "notes", 4000);
  if (!notes.ok) return notes;

  return {
    ok: true,
    value: {
      name: name.value,
      company: company.value,
      email: emailRaw.value.toLowerCase(),
      website: website.value,
      source: source.value,
      notes: notes.value,
    },
  };
}

export interface LookupRequest {
  email?: string;
  company?: string;
  website?: string;
  domain?: string;
}

export function parseLookupRequest(params: URLSearchParams): Parsed<LookupRequest> {
  const email = params.get("email")?.trim() || undefined;
  const company = params.get("company")?.trim() || undefined;
  const website = params.get("website")?.trim() || undefined;
  const domain = params.get("domain")?.trim() || undefined;
  if (!email && !company && !website && !domain) {
    return { ok: false, error: "email, company, website, or domain is required" };
  }
  if (email && (email.length > 254 || !isEmail(email.toLowerCase()))) {
    return { ok: false, error: "email is not valid" };
  }
  if (company && company.length > 160) return { ok: false, error: "company is too long" };
  if (website && (website.length > 300 || !websiteHost(website))) {
    return { ok: false, error: "website must be a host or http(s) URL" };
  }
  if (domain && (domain.length > 253 || !organizationDomain(domain))) {
    return { ok: false, error: "domain is not a usable host" };
  }
  return {
    ok: true,
    value: {
      email: email?.toLowerCase(),
      company,
      website,
      domain: domain ? organizationDomain(domain) ?? undefined : undefined,
    },
  };
}

const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "hey.com",
]);

export function websiteHost(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return organizationDomain(url.hostname);
  } catch {
    return null;
  }
}

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return organizationDomain(email.slice(at + 1));
}

export function organizationDomain(host: string): string | null {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return null;
  if (FREE_MAIL_DOMAINS.has(normalized)) return null;
  return normalized;
}

export function organizationalDomains(input: { email?: string; website?: string; domain?: string }): string[] {
  const domains = [
    input.domain ? organizationDomain(input.domain) : null,
    input.email ? emailDomain(input.email) : null,
    input.website ? websiteHost(input.website) : null,
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(domains));
}

export interface DraftInsert {
  slug: string;
  title: string;
  subtitle: string | null;
  content_type: "article";
  body: string;
  excerpt: string;
  semantic_tags: string[];
  target_segments: string[];
  seo_meta_id?: string;
  featured_image_url: null;
  featured_video_url: null;
  status: "draft";
  published_at: null;
  created_by: "content_agent";
  author_name: typeof ASSISTANT_AUTHOR_NAME;
}

/** The only article row the assistant API is allowed to insert. */
export function buildDraftInsert(input: {
  slug: string;
  title: string;
  subtitle?: string | null;
  body: string;
  excerpt: string;
  semantic_tags?: string[];
  target_segments?: string[];
  seo_meta_id?: string;
}): DraftInsert {
  return {
    slug: input.slug,
    title: input.title,
    subtitle: input.subtitle?.trim() || null,
    content_type: "article",
    body: input.body,
    excerpt: input.excerpt,
    semantic_tags: (input.semantic_tags || []).slice(0, 8),
    target_segments: (input.target_segments || []).slice(0, 6),
    seo_meta_id: input.seo_meta_id,
    featured_image_url: null,
    featured_video_url: null,
    status: "draft",
    published_at: null,
    created_by: "content_agent",
    author_name: ASSISTANT_AUTHOR_NAME,
  };
}

export function shouldAttachImage(status: string | null | undefined, attach: boolean): boolean {
  return attach && status === "draft";
}

/** Patch applied to a draft. Status, dates, and publish fields are absent on purpose. */
export function imageAttachmentPatch(url: string): { featured_image_url: string } {
  return { featured_image_url: url };
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "draft";
}

export function clampList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= maxLength)
    .slice(0, maxItems);
}
