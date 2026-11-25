import assert from "node:assert/strict";
import test from "node:test";
import { signRequestPayload, requestSigningPayload } from "../api/signature.ts";
import { authenticateAssistantHeaders, readAssistantCredentials } from "./auth.ts";
import { listLeadMatches, pickLeadMatch } from "./leads-match.ts";
import { leadIdFromNotesPath, parseResearchNote, researchActivity } from "./research-note.ts";
import {
  BLOCKED_MUTATION_FIELDS,
  buildDraftInsert,
  imageAttachmentPatch,
  organizationalDomains,
  parseDraftRequest,
  parseImageRequest,
  parseLeadRequest,
  parseLookupRequest,
  shouldAttachImage,
} from "./validate.ts";

const env = {
  ASSISTANT_API_KEY: "assistant-key",
  ASSISTANT_HMAC_SECRET: "assistant-hmac",
  API_SECRET_KEY: "master-key",
  API_SIGNATURE_REQUIRED: "false",
};

function headers(method: string, path: string, body: string, key = env.ASSISTANT_API_KEY, secret = env.ASSISTANT_HMAC_SECRET) {
  const timestamp = "1700000000";
  return {
    apiKey: key,
    timestamp,
    signature: signRequestPayload(secret, requestSigningPayload(method, path, timestamp, body)),
    method,
    pathname: path,
    bodyText: body,
    nowSeconds: 1700000000,
  };
}

test("assistant credentials are required and must not reuse the master key", () => {
  assert.equal(readAssistantCredentials({}).ok, false);
  assert.equal(readAssistantCredentials({ ASSISTANT_API_KEY: "a" }).ok, false);
  assert.equal(readAssistantCredentials({ ...env, ASSISTANT_API_KEY: "master-key" }).ok, false);
  assert.equal(readAssistantCredentials({ ...env, ASSISTANT_HMAC_SECRET: "master-key" }).ok, false);
  assert.equal(readAssistantCredentials(env).ok, true);
});

test("the assistant route always checks HMAC and never accepts the master key", () => {
  const body = '{"title":"The first lookup"}';
  const ok = authenticateAssistantHeaders(env, headers("POST", "/api/assistant/drafts", body));
  assert.equal(ok.ok, true);

  const master = authenticateAssistantHeaders(
    env,
    headers("POST", "/api/assistant/drafts", body, "master-key", "master-key")
  );
  assert.equal(master.ok, false);
  if (!master.ok) assert.equal(master.status, 401);

  const unsigned = authenticateAssistantHeaders(env, {
    ...headers("POST", "/api/assistant/drafts", body),
    signature: null,
  });
  assert.equal(unsigned.ok, false);
  if (!unsigned.ok) assert.equal(unsigned.status, 401);

  const unset = authenticateAssistantHeaders({}, headers("POST", "/api/assistant/drafts", body));
  assert.equal(unset.ok, false);
  if (!unset.ok) assert.equal(unset.status, 503);
});

test("draft creation rejects publish fields and stores a draft byline", () => {
  for (const field of BLOCKED_MUTATION_FIELDS) {
    const parsed = parseDraftRequest({ title: "The first lookup", [field]: "published" });
    assert.equal(parsed.ok, false, field);
  }
  const parsed = parseDraftRequest({
    title: "The first lookup",
    brief: "Referral buyers check the site.",
    target_keyword: "first lookup",
    pillar: "reputation and the first lookup",
  });
  assert.equal(parsed.ok, true);
  const row = buildDraftInsert({
    slug: "the-first-lookup",
    title: "The first lookup",
    body: "<p>Draft</p>",
    excerpt: "A draft",
  });
  assert.equal(row.status, "draft");
  assert.equal(row.published_at, null);
  assert.equal(row.author_name, "Editorial draft");
  assert.equal(row.created_by, "content_agent");
  assert.equal("publish_mode" in row, false);
});

test("images attach only to drafts and the patch cannot publish", () => {
  assert.equal(parseImageRequest({ publish_mode: "autonomous", prompt: "A quiet room" }).ok, false);
  assert.equal(parseImageRequest({}).ok, false);
  assert.equal(shouldAttachImage("draft", true), true);
  assert.equal(shouldAttachImage("published", true), false);
  assert.equal(shouldAttachImage("draft", false), false);
  assert.deepEqual(Object.keys(imageAttachmentPatch("https://example.com/a.webp")), ["featured_image_url"]);
});

test("lead input rejects workflow and deal fields", () => {
  assert.equal(parseLeadRequest({ name: "Ada", email: "ada@firm.example", workflow_id: "wf" }).ok, false);
  assert.equal(parseLeadRequest({ name: "Ada", email: "not-an-email" }).ok, false);
  const parsed = parseLeadRequest({
    name: "Ada Quinn",
    company: "North Ledger",
    email: "ada@northledger.example",
    website: "https://northledger.example",
    source: "referral",
    notes: "Looked the studio up.",
  });
  assert.equal(parsed.ok, true);
  const lookup = parseLookupRequest(new URLSearchParams({ email: "ada@northledger.example" }));
  assert.equal(lookup.ok, true);
});

test("research notes are timeline notes labeled Research and created by assistant", () => {
  const parsed = parseResearchNote({
    title: "What the site says in ninety seconds",
    body: "The public page names the practice and nothing more.",
    source_urls: ["https://northledger.example/about"],
    kind: "research",
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const activity = researchActivity(parsed.value);
  assert.equal(activity.activity_type, "note");
  assert.equal(activity.title, "Research: What the site says in ninety seconds");
  assert.equal(activity.actor, "Created by assistant");
  assert.match(activity.body, /Sources:\n- https:\/\/northledger.example\/about/);
  assert.equal(activity.data.kind, "research");
  assert.deepEqual(Object.keys(activity).sort(), ["activity_type", "actor", "body", "data", "title"]);

  const audit = parseResearchNote({ title: "Sample", body: "Notes.", kind: "audit" });
  assert.equal(audit.ok, true);
  if (audit.ok) assert.equal(researchActivity(audit.value).title, "Audit: Sample");

  assert.equal(parseResearchNote({ title: "Sample", body: "Notes." }).ok, true);
  assert.equal(parseResearchNote({ title: "Sample", body: "Notes.", source_urls: ["javascript:alert(1)"] }).ok, false);
  assert.equal(parseResearchNote({ title: "Sample", body: "Notes.", workflow_id: "wf" }).ok, false);
  assert.equal(leadIdFromNotesPath("/api/assistant/leads/11111111-1111-4111-8111-111111111111/notes"), "11111111-1111-4111-8111-111111111111");
  assert.equal(leadIdFromNotesPath("/api/assistant/leads/not-a-lead/notes"), null);

  const withNote = parseLeadRequest({
    name: "Ada Quinn",
    email: "ada@northledger.example",
    research_note: { title: "Lookup", body: "Quiet site." },
  });
  assert.equal(withNote.ok, true);
  if (withNote.ok) assert.equal(withNote.value.research_note?.kind, "research");
});

test("lead matching prefers email, then company, then an organizational domain", () => {
  const leads = [
    { id: "1", email: "ada@northledger.example", company: "North Ledger" },
    { id: "2", email: "other@gmail.com", company: "Other" },
  ];
  assert.equal(
    pickLeadMatch({ email: "ada@northledger.example", company: "North Ledger", domains: ["northledger.example"] }, leads)?.matched_on,
    "email"
  );
  assert.equal(
    pickLeadMatch({ email: "new@northledger.example", company: "North Ledger", domains: ["northledger.example"] }, leads)?.matched_on,
    "company"
  );
  assert.equal(
    pickLeadMatch({ email: "new@northledger.example", domains: ["northledger.example"] }, leads)?.matched_on,
    "domain"
  );
  assert.equal(
    pickLeadMatch({ email: "someone@gmail.com", domains: organizationalDomains({ email: "someone@gmail.com" }) }, leads),
    null
  );
  assert.equal(listLeadMatches({ email: "ada@northledger.example", domains: [] }, leads)[0]?.lead.id, "1");
});
