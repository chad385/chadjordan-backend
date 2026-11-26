# Assistant API

A separate machine API for Chad's team assistants. It can save a brand-context draft, generate an image, add a CRM lead, and attach a research note to a lead. It cannot publish, schedule, change publish mode, open a deal, start a workflow, or send email.

The master key (`API_SECRET_KEY`) is not accepted. If `ASSISTANT_API_KEY` or `ASSISTANT_HMAC_SECRET` is unset, or if either value repeats the master key or master signing secret, every route returns **503** and does no work.

## Authentication

Every request, including GET, sends:

| Header | Value |
| --- | --- |
| `x-api-key` | `ASSISTANT_API_KEY` |
| `x-timestamp` | Unix seconds |
| `x-signature` | Hex HMAC-SHA256 of the payload |

Payload, same helper the rest of the machine API uses:

```text
METHOD:pathname:timestamp:body
```

- Method is uppercase.
- `pathname` is the path only. The query string is not signed.
- GET body is an empty string.
- The timestamp must fall inside `API_REQUEST_SIGNATURE_TTL_SECONDS` (default 300). `API_SIGNATURE_REQUIRED=false` does not turn this check off.

A wrong key or signature is **401**. Bodies over 32 KB are **413**. Each assistant key is limited to 20 requests per 15 minutes (**429**). The limit is counted from `assistant_api_audit`.

## Endpoints

Base URL is the backend origin, for example `https://chadjordan-backend.chad-1a0.workers.dev`.

### `POST /api/assistant/drafts`

The backend writes the article from the live `brand_context` playbook projection. The caller does not send HTML. The row is always `status: "draft"`, `published_at: null`, and `author_name: "Editorial draft"`. That byline is a neutral internal value. The route never publishes, never writes `content_calendar`, and never changes `publish_mode`.

Request:

```json
{
  "title": "What a referral buyer sees in ninety seconds",
  "brief": "Optional topic notes. Instructions to publish are ignored.",
  "target_keyword": "reputation and the first lookup",
  "pillar": "reputation and the first lookup"
}
```

`title` is required (4–180 characters). `brief` max 4,000. `target_keyword` max 120. `pillar` max 160.

Response `201`:

```json
{
  "draft": {
    "id": "uuid",
    "slug": "what-a-referral-buyer-sees-in-ninety-seconds",
    "title": "What a referral buyer sees in ninety seconds",
    "status": "draft",
    "author_name": "Editorial draft",
    "public": false
  },
  "review": {
    "unsupported_claims": [],
    "editor_error": null
  }
}
```

Needs `ANTHROPIC_API_KEY` and a ready playbook projection. Otherwise **503** and nothing is stored.

### `GET /api/assistant/drafts`

Lists drafts this API stored (`author_name` is `Editorial draft`, status is still `draft`). `?limit=` is 1–50, default 20.

Response `200`:

```json
{
  "drafts": [
    {
      "id": "uuid",
      "slug": "what-a-referral-buyer-sees-in-ninety-seconds",
      "title": "What a referral buyer sees in ninety seconds",
      "status": "draft",
      "created_at": "2026-11-24T17:00:00Z",
      "updated_at": "2026-11-24T17:00:00Z"
    }
  ]
}
```

### `POST /api/assistant/images`

Generates an image with the configured OpenAI image model and the brand image style. Returns the public media URL. Attaches it to a draft's `featured_image_url` only when that row is still a draft and `attach` is not `false`. A published row is never updated. Status is never changed.

Request (one of `draft_id` or `prompt`):

```json
{
  "draft_id": "uuid",
  "prompt": "A quiet archive table, one folder, no readable text",
  "attach": true
}
```

`prompt` max 2,000 characters.

Response `200`:

```json
{
  "url": "https://backend.example/media/public/blog/draft-….webp",
  "draft_id": "uuid",
  "attached": true,
  "published": false
}
```

Needs `OPENAI_API_KEY`, the public media bucket, and the `IMAGES` binding. A prompt-only request does not create an article.

### `POST /api/assistant/leads`

Inserts a lead with workflow triggers, deal creation, and automatic email left off. Existing email matches update the same lead. An exact company name, or the same organizational email domain, also updates the existing lead instead of inserting another. Free-mail domains (gmail, outlook, and the like) are not treated as a company match.

Request:

```json
{
  "name": "Ada Quinn",
  "company": "North Ledger",
  "email": "ada@northledger.example",
  "website": "https://northledger.example",
  "source": "referral",
  "notes": "Looked the studio up after an introduction.",
  "research_note": {
    "title": "What the site says in ninety seconds",
    "body": "The public page names the practice and nothing more.",
    "source_urls": ["https://northledger.example/about"],
    "kind": "research"
  }
}
```

`name` and `email` are required. `notes` is still the short message stored like a contact-form note. `research_note` is optional and uses the same shape as `POST /api/assistant/leads/{id}/notes`. It is attached after the lead is saved, including when the lead already existed.

Response `200`:

```json
{
  "lead_id": "uuid",
  "created": true,
  "deduped": false,
  "matched_on": null,
  "research_note": {
    "note_id": "uuid",
    "title": "Research: What the site says in ninety seconds",
    "kind": "research"
  },
  "workflow_started": false,
  "deal_created": false,
  "email_sent": false
}
```

`research_note` is `null` when the request did not include one. `matched_on` is `email`, `company`, or `domain` when an existing lead was used.

### `POST /api/assistant/leads/{id}/notes`

Attaches a finding to an existing lead. Same key, HMAC, audit row, 32 KB body limit, and per-key rate limit as the other assistant routes. The note is a CRM timeline note (`activity_type: "note"`), the same record a contact-form message uses, so it shows on the lead page under Notes. The stored title is `Research: …` (or `Audit: …` when `kind` is `audit`). The actor line is `Created by assistant`. This call does not start a workflow, open a deal, or send email.

Sign the full path, for example `/api/assistant/leads/11111111-1111-4111-8111-111111111111/notes`.

Request:

```json
{
  "title": "What the site says in ninety seconds",
  "body": "The public page names the practice and nothing more.",
  "source_urls": ["https://northledger.example/about"],
  "kind": "research"
}
```

`title` (1–180) and `body` (markdown, 1–20,000) are required. `kind` defaults to `research`. Use a short label such as `research` or `audit`. `source_urls` is optional, at most 8 http(s) URLs. They are listed at the end of the note body.

Response `201`:

```json
{
  "note_id": "uuid",
  "lead_id": "uuid",
  "title": "Research: What the site says in ninety seconds",
  "kind": "research",
  "actor": "Created by assistant",
  "workflow_started": false,
  "deal_created": false,
  "email_sent": false
}
```

Unknown or malformed lead ids return **404**.

### `GET /api/assistant/leads/lookup`

Read-only. At least one of `email`, `company`, `website`, or `domain`.

```text
GET /api/assistant/leads/lookup?email=ada@northledger.example
```

Sign the path `/api/assistant/leads/lookup` with an empty body. Do not include the query string in the signature.

Response `200`:

```json
{
  "exists": true,
  "matches": [
    {
      "id": "uuid",
      "email": "ada@northledger.example",
      "company": "North Ledger",
      "matched_on": "email",
      "review_status": "not_reviewed",
      "review_comment": null
    }
  ]
}
```

`review_status` is `not_reviewed`, `approved`, or `needs_changes`. `review_comment` is Chad's optional note, or `null`.

### `POST /api/assistant/leads/{id}/images`

Attaches a still image to a lead. Same key, HMAC, audit row, and per-key rate limit as the notes route. The JSON body may be up to 6 MB so a 4 MB image fits after base64. PNG, JPG, and WebP only. The file is stored in the private `lead-stills` bucket and appears on the lead page. This call does not send email, start a workflow, or open a deal.

Sign the path `/api/assistant/leads/{id}/images` and the JSON body.

```json
{
  "filename": "sample.webp",
  "data_base64": "<base64 of the image bytes>"
}
```

Response `201`:

```json
{
  "image_id": "uuid",
  "lead_id": "uuid",
  "content_type": "image/webp",
  "byte_size": 120000,
  "workflow_started": false,
  "deal_created": false,
  "email_sent": false
}
```

Unknown lead ids return **404**. A missing `lead-stills` bucket returns **503**.

## Signing example

Node:

```js
import { createHmac } from "node:crypto";

const key = process.env.ASSISTANT_API_KEY;
const secret = process.env.ASSISTANT_HMAC_SECRET;
const base = process.env.BACKEND_URL.replace(/\/$/, "");

async function assistant(method, path, body) {
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = [method, path, timestamp, bodyText].join(":");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const response = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "x-timestamp": timestamp,
      "x-signature": signature,
    },
    body: bodyText || undefined,
  });
  return response.json();
}

await assistant("POST", "/api/assistant/leads/11111111-1111-4111-8111-111111111111/notes", {
  title: "What the site says in ninety seconds",
  body: "The public page names the practice and nothing more.",
  kind: "research",
});
```

curl (empty GET body; set the three variables first):

```bash
PATHNAME=/api/assistant/leads/lookup
QUERY='?email=ada@northledger.example'
TS=$(date +%s)
SIG=$(node -e 'const {createHmac}=require("node:crypto"); const [method,path,ts]=process.argv.slice(1); process.stdout.write(createHmac("sha256", process.env.ASSISTANT_HMAC_SECRET).update([method,path,ts,""].join(":")).digest("hex"))' GET "$PATHNAME" "$TS")
curl -sS "$BACKEND_URL$PATHNAME$QUERY" \
  -H "x-api-key: $ASSISTANT_API_KEY" \
  -H "x-timestamp: $TS" \
  -H "x-signature: $SIG"
```

## Environment variables

Set these on the **Cloudflare Worker** with `wrangler secret put`. Paste the value only. Do not put them in `wrangler.jsonc` and do not commit them.

| Variable | Where | Purpose |
| --- | --- | --- |
| `ASSISTANT_API_KEY` | Cloudflare secret, and gitignored `.env.local` for local dev | Assistant `x-api-key`. Must differ from `API_SECRET_KEY`. |
| `ASSISTANT_HMAC_SECRET` | Cloudflare secret, and `.env.local` | HMAC secret for assistant requests. Must differ from `API_SECRET_KEY` and from `API_REQUEST_SIGNING_SECRET`. |
| `API_REQUEST_SIGNATURE_TTL_SECONDS` | Already used by the machine API. Optional. Default 300. | Shared timestamp window. |
| `ANTHROPIC_API_KEY` | Already a Worker secret | Required for `POST /api/assistant/drafts` and for image subjects chosen from a draft. |
| `OPENAI_API_KEY` | Already a Worker secret | Required for `POST /api/assistant/images`. |
| `OPENAI_IMAGE_MODEL` | Already a Worker var | Image model. Defaults to `gpt-image-1` when unset. |

**Supabase does not store these keys.** Supabase holds the audit table and the brand rows.

## What has to be applied in Supabase

1. Run `supabase/migrations/003_assistant_api_audit.sql` in the SQL editor or with the Supabase CLI. Until that table exists, an authenticated call returns **503** and does not write a draft, image, or lead.
2. Publish the repositioned playbook so topic research and drafts read the new audience. Dry-run first:

```bash
node --experimental-strip-types scripts/seed-brand-playbook.ts
node --env-file=.env.local --experimental-strip-types scripts/seed-brand-playbook.ts --apply
```

`--apply` writes `backend_settings` key `brand_playbook:current` and the `brand_context` projection. It archives the previous current row. Do not point `.env.local` at production unless you intend to replace the live playbook.

The dashboard shows **Created by assistant** on a draft whose byline is `Editorial draft`. Publishing that draft is still a human action in the dashboard; this API will not do it. Set the public byline before a person publishes.
