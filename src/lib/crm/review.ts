export const REVIEW_STATUSES = ["not_reviewed", "approved", "needs_changes"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  not_reviewed: "Not reviewed",
  approved: "Approved",
  needs_changes: "Needs changes",
};

const COMMENT_MAX = 500;

export function parseReviewUpdate(
  body: unknown
): { ok: true; status: ReviewStatus; comment: string | null } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "JSON body must be an object" };
  }
  const record = body as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => key !== "status" && key !== "comment");
  if (extra.length > 0) return { ok: false, error: `Unknown fields: ${extra.join(", ")}` };
  if (typeof record.status !== "string" || !REVIEW_STATUSES.includes(record.status as ReviewStatus)) {
    return { ok: false, error: "status must be not_reviewed, approved, or needs_changes" };
  }
  let comment: string | null = null;
  if (record.comment !== undefined && record.comment !== null && record.comment !== "") {
    if (typeof record.comment !== "string") return { ok: false, error: "comment must be a string" };
    const trimmed = record.comment.trim();
    if (trimmed.length > COMMENT_MAX) return { ok: false, error: `comment must be at most ${COMMENT_MAX} characters` };
    comment = trimmed || null;
  }
  return { ok: true, status: record.status as ReviewStatus, comment };
}
