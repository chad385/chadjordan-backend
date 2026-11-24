export type LeadMatchOn = "email" | "company" | "domain";

export interface LeadCandidate {
  id: string;
  email: string;
  company: string | null;
}

export interface LeadMatch {
  lead: LeadCandidate;
  matched_on: LeadMatchOn;
}

function sameEmail(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sameCompany(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left?.trim() || !right?.trim()) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function hostOfEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Prefer an exact email, then an exact company name, then a shared
 * organizational email domain. Free-mail domains are not passed in `domains`.
 */
export function pickLeadMatch(
  input: { email: string; company?: string; domains: string[] },
  candidates: LeadCandidate[]
): LeadMatch | null {
  const byEmail = candidates.find((lead) => sameEmail(lead.email, input.email));
  if (byEmail) return { lead: byEmail, matched_on: "email" };

  if (input.company) {
    const byCompany = candidates.find((lead) => sameCompany(lead.company, input.company));
    if (byCompany) return { lead: byCompany, matched_on: "company" };
  }

  const domains = new Set(input.domains.map((domain) => domain.toLowerCase()));
  if (domains.size === 0) return null;
  const byDomain = candidates.find((lead) => {
    const host = hostOfEmail(lead.email);
    return host ? domains.has(host) : false;
  });
  if (byDomain) return { lead: byDomain, matched_on: "domain" };
  return null;
}

export function escapeIlike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

const MATCH_RANK: Record<LeadMatchOn, number> = { email: 0, company: 1, domain: 2 };

/** Every candidate that matches, one row per lead, strongest reason kept. */
export function listLeadMatches(
  input: { email?: string; company?: string; domains: string[] },
  candidates: LeadCandidate[]
): LeadMatch[] {
  const byId = new Map<string, LeadMatch>();
  for (const lead of candidates) {
    const match = pickLeadMatch(
      { email: input.email || "", company: input.company, domains: input.domains },
      [lead]
    );
    if (!match) continue;
    const existing = byId.get(lead.id);
    if (!existing || MATCH_RANK[match.matched_on] < MATCH_RANK[existing.matched_on]) {
      byId.set(lead.id, match);
    }
  }
  return Array.from(byId.values()).sort(
    (a, b) => MATCH_RANK[a.matched_on] - MATCH_RANK[b.matched_on]
  );
}
