import assert from "node:assert/strict";
import test from "node:test";
import {
  alertNewLeads,
  newLeadEmail,
  NEW_LEAD_ALERTS_KEY,
  NEW_LEAD_ALERT_TITLE,
  NEW_LEAD_WATERMARK_KEY,
  type AlertLead,
} from "./new-lead-alerts.ts";

type Row = Record<string, unknown>;

/** Minimal in-memory stand-in for the Supabase query builder used by the alerts. */
function fakeDb(seed: { settings?: Row[]; leads?: AlertLead[]; activities?: Row[] }) {
  const tables: Record<string, Row[]> = {
    backend_settings: [...(seed.settings || [])],
    leads: [...((seed.leads || []) as unknown as Row[])],
    lead_activities: [...(seed.activities || [])],
  };
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let order: string | null = null;
    let limit = Infinity;
    const q = {
      select: () => q,
      in: (k: string, v: unknown[]) => (filters.push((r) => v.includes(r[k])), q),
      eq: (k: string, v: unknown) => (filters.push((r) => r[k] === v), q),
      gt: (k: string, v: string) => (filters.push((r) => String(r[k]) > v), q),
      order: (k: string) => ((order = k), q),
      limit: (n: number) => ((limit = n), q),
      upsert: async (row: Row) => {
        const rows = tables[table];
        const i = rows.findIndex((r) => r.key === row.key);
        if (i >= 0) rows[i] = { ...rows[i], ...row };
        else rows.push(row);
        return { error: null };
      },
      insert: async (row: Row) => (tables[table].push(row), { error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        let data = tables[table].filter((r) => filters.every((f) => f(r)));
        if (order) data = [...data].sort((a, b) => String(a[order!]).localeCompare(String(b[order!])));
        resolve({ data: data.slice(0, limit), error: null });
      },
    };
    return q;
  }
  return { db: { from } as never, tables };
}

const lead = (id: string, created_at: string, extra: Partial<AlertLead> = {}): AlertLead => ({
  id,
  email: `${id}@example.com`,
  first_name: null,
  last_name: null,
  source: "contact",
  capture_page: "/contact",
  tags: ["compound-inquiry"],
  created_at,
  ...extra,
});

const setting = (rows: Row[], key: string) => rows.find((r) => r.key === key)?.value;

function deps(tables: Record<string, Row[]>, notify: (s: string, b: string) => Promise<{ sent: boolean; error?: string }>, now?: () => Date) {
  return {
    notify,
    logAlert: async (leadId: string) => {
      tables.lead_activities.push({ lead_id: leadId, activity_type: "note", title: NEW_LEAD_ALERT_TITLE });
    },
    now,
  };
}

test("off by default: no email, no watermark", async () => {
  const { db, tables } = fakeDb({ leads: [lead("a", "2026-10-26T10:00:00Z")] });
  let sent = 0;
  const out = await alertNewLeads(db, deps(tables, async () => ((sent++), { sent: true })));
  assert.deepEqual(out, { alerted: 0, errors: [] });
  assert.equal(sent, 0);
  assert.equal(setting(tables.backend_settings, NEW_LEAD_WATERMARK_KEY), undefined);
});

test("switching on starts from now, so older leads never alert", async () => {
  const { db, tables } = fakeDb({
    settings: [{ key: NEW_LEAD_ALERTS_KEY, value: true }],
    leads: [lead("old", "2026-10-26T10:00:00Z")],
  });
  let sent = 0;
  await alertNewLeads(db, deps(tables, async () => ((sent++), { sent: true }), () => new Date("2026-10-26T15:00:00Z")));
  assert.equal(sent, 0);
  assert.equal(setting(tables.backend_settings, NEW_LEAD_WATERMARK_KEY), "2026-10-26T15:00:00.000Z");
});

test("one email per new lead, oldest first, watermark advances", async () => {
  const { db, tables } = fakeDb({
    settings: [
      { key: NEW_LEAD_ALERTS_KEY, value: true },
      { key: NEW_LEAD_WATERMARK_KEY, value: "2026-10-26T15:00:00Z" },
    ],
    leads: [
      lead("before", "2026-10-26T14:00:00Z"),
      lead("second", "2026-10-26T15:10:00Z"),
      lead("first", "2026-10-26T15:05:00Z", { first_name: "Ada" }),
    ],
  });
  const subjects: string[] = [];
  const out = await alertNewLeads(db, deps(tables, async (s) => (subjects.push(s), { sent: true })));
  assert.equal(out.alerted, 2);
  assert.deepEqual(subjects, ["New lead: Ada", "New lead: second@example.com"]);
  assert.equal(setting(tables.backend_settings, NEW_LEAD_WATERMARK_KEY), "2026-10-26T15:10:00Z");
  assert.equal(tables.lead_activities.filter((a) => a.title === NEW_LEAD_ALERT_TITLE).length, 2);

  // A second tick with nothing new sends nothing.
  const again = await alertNewLeads(db, deps(tables, async (s) => (subjects.push(s), { sent: true })));
  assert.equal(again.alerted, 0);
  assert.equal(subjects.length, 2);
});

test("a failed send stops there and is retried next tick", async () => {
  const { db, tables } = fakeDb({
    settings: [
      { key: NEW_LEAD_ALERTS_KEY, value: true },
      { key: NEW_LEAD_WATERMARK_KEY, value: "2026-10-26T15:00:00Z" },
    ],
    leads: [lead("x", "2026-10-26T15:01:00Z"), lead("y", "2026-10-26T15:02:00Z")],
  });
  let fail = true;
  const sent: string[] = [];
  const first = await alertNewLeads(db, deps(tables, async (s) => (fail ? { sent: false, error: "domain not verified" } : (sent.push(s), { sent: true }))));
  assert.equal(first.alerted, 0);
  assert.match(first.errors[0], /domain not verified/);
  assert.equal(setting(tables.backend_settings, NEW_LEAD_WATERMARK_KEY), "2026-10-26T15:00:00Z");

  fail = false;
  const second = await alertNewLeads(db, deps(tables, async (s) => (sent.push(s), { sent: true })));
  assert.equal(second.alerted, 2);
  assert.equal(sent.length, 2);
});

test("a lead already alerted is not emailed twice", async () => {
  const { db, tables } = fakeDb({
    settings: [
      { key: NEW_LEAD_ALERTS_KEY, value: true },
      { key: NEW_LEAD_WATERMARK_KEY, value: "2026-10-26T15:00:00Z" },
    ],
    leads: [lead("dup", "2026-10-26T15:01:00Z")],
    activities: [{ lead_id: "dup", activity_type: "note", title: NEW_LEAD_ALERT_TITLE }],
  });
  let sent = 0;
  const out = await alertNewLeads(db, deps(tables, async () => ((sent++), { sent: true })));
  assert.equal(sent, 0);
  assert.equal(out.alerted, 0);
});

test("email names the person, page and tags", () => {
  const { subject, body } = newLeadEmail(lead("z", "2026-10-26T15:01:00Z", { first_name: "Sam", last_name: "Lee" }));
  assert.equal(subject, "New lead: Sam Lee");
  assert.match(body, /Sam Lee \(z@example\.com\)/);
  assert.match(body, /Page: \/contact/);
  assert.match(body, /compound-inquiry/);
});
