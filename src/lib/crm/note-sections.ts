export type ReviewNoteKind = "audit" | "outreach";

export function noteSectionKind(activity: {
  activity_type: string;
  title: string;
  data?: Record<string, unknown> | null;
}): ReviewNoteKind | null {
  if (activity.activity_type !== "note") return null;
  const raw = activity.data?.kind;
  const kind = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (kind === "audit" || kind === "outreach") return kind;
  const title = activity.title.trim().toLowerCase();
  if (title.startsWith("audit:")) return "audit";
  if (title.startsWith("outreach:")) return "outreach";
  return null;
}

export function notesForSection<T extends { activity_type: string; title: string; created_at: string; data?: Record<string, unknown> | null }>(
  activities: T[],
  kind: ReviewNoteKind
): T[] {
  return activities
    .filter((activity) => noteSectionKind(activity) === kind)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
