/** Shown under the note on the lead timeline. The page prints `actor` as-is. */
export const ASSISTANT_NOTE_ACTOR = "Created by assistant";

export interface ResearchNote {
  title: string;
  body: string;
  source_urls: string[];
  kind: string;
}

const KIND = /^[a-z][a-z0-9_-]{0,31}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function leadIdFromNotesPath(pathname: string): string | null {
  const match = /^\/api\/assistant\/leads\/([^/]+)\/notes$/.exec(pathname);
  if (!match || !UUID.test(match[1])) return null;
  return match[1];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * The note row the lead page already renders: activity_type "note", a title,
 * the markdown body, and the actor line. Kind is the visible label
 * ("Research", "Audit"). No workflow, deal, or email fields are included.
 */
export function researchActivity(note: ResearchNote): {
  activity_type: "note";
  title: string;
  body: string;
  actor: typeof ASSISTANT_NOTE_ACTOR;
  data: { assistant: true; kind: string; source_urls: string[] };
} {
  const sources = note.source_urls.length
    ? `\n\nSources:\n${note.source_urls.map((url) => `- ${url}`).join("\n")}`
    : "";
  return {
    activity_type: "note",
    title: `${kindLabel(note.kind)}: ${note.title}`,
    body: `${note.body}${sources}`,
    actor: ASSISTANT_NOTE_ACTOR,
    data: { assistant: true, kind: note.kind, source_urls: note.source_urls },
  };
}

export function parseResearchNote(
  value: unknown
): { ok: true; value: ResearchNote } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "research note must be an object" };
  }
  const body = value as Record<string, unknown>;
  const allowed = ["title", "body", "source_urls", "kind"];
  const extra = Object.keys(body).filter((key) => !allowed.includes(key));
  if (extra.length > 0) return { ok: false, error: `Unknown research note fields: ${extra.join(", ")}` };

  if (typeof body.title !== "string" || body.title.trim().length < 1 || body.title.trim().length > 180) {
    return { ok: false, error: "title must be 1-180 characters" };
  }
  if (typeof body.body !== "string" || body.body.trim().length < 1 || body.body.trim().length > 20000) {
    return { ok: false, error: "body must be 1-20000 characters of markdown" };
  }

  let kind = "research";
  if (body.kind !== undefined && body.kind !== null && body.kind !== "") {
    if (typeof body.kind !== "string") return { ok: false, error: "kind must be a string" };
    kind = body.kind.trim().toLowerCase();
    if (!KIND.test(kind)) return { ok: false, error: "kind must be a short label such as research or audit" };
  }

  const source_urls: string[] = [];
  if (body.source_urls !== undefined) {
    if (!Array.isArray(body.source_urls)) return { ok: false, error: "source_urls must be an array" };
    if (body.source_urls.length > 8) return { ok: false, error: "source_urls accepts at most 8 URLs" };
    for (const entry of body.source_urls) {
      if (typeof entry !== "string" || entry.length > 500 || !isHttpUrl(entry.trim())) {
        return { ok: false, error: "each source_urls entry must be an http(s) URL" };
      }
      source_urls.push(entry.trim());
    }
  }

  return {
    ok: true,
    value: {
      title: body.title.trim(),
      body: body.body.trim(),
      source_urls,
      kind,
    },
  };
}
