/** Neutral byline stored on assistant drafts. It is not a public author name. */
export const ASSISTANT_AUTHOR_NAME = "Editorial draft";

/** Requests per assistant key inside the window below. Counted from the audit table. */
export const ASSISTANT_RATE_LIMIT = 20;
export const ASSISTANT_RATE_WINDOW_SECONDS = 15 * 60;

/** Reject bodies larger than this before any model or database write. */
export const ASSISTANT_MAX_BODY_BYTES = 32 * 1024;
