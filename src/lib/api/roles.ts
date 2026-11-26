/** Dashboard session roles. Anything else, including a missing role, is rejected. */
export type SessionRole = "admin" | "social";

export function sessionRole(metadata: unknown): SessionRole | null {
  if (!metadata || typeof metadata !== "object") return null;
  const role = (metadata as { role?: unknown }).role;
  if (role === "admin" || role === "social") return role;
  return null;
}
