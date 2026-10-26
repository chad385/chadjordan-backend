# Changes From Stock

Tracks every deviation from the upstream template (`https://github.com/lukesbrave/digital-home-backend`)
so upstream updates can be pulled in cleanly later. No branding, styling, or
content-corpus changes belong in this repo.

## wrangler.jsonc

- `vars.SUPABASE_URL`, `vars.SUPABASE_ANON_KEY`, `vars.NEXT_PUBLIC_SUPABASE_URL`,
  `vars.NEXT_PUBLIC_SUPABASE_ANON_KEY` replaced with this project's real
  Supabase project URL / publishable key.
- `vars.DIGITAL_HOME_URL` and `vars.NEXT_PUBLIC_DIGITAL_HOME_URL` replaced
  with this project's live Frontend Worker URL
  (`https://digital-home-frontend.chad-1a0.workers.dev`).
- `vars.R2_PUBLIC_BASE` left as the stock placeholder — Meta/social setup is
  deferred, not part of the golden-path plumbing check.

All project-specific — every clone must set its own.

## .env.local (gitignored, not committed)

- Created from `.env.local.example`. Filled with this project's Supabase
  URL/anon/service_role keys, the same generated `API_SECRET_KEY` as the
  Frontend, `DIGITAL_HOME_URL` pointing at the live Frontend Worker,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

## Cloudflare R2 bucket

- Created a `social-media` R2 bucket in Cloudflare (referenced by
  `wrangler.jsonc`'s `r2_buckets` binding but did not exist yet — deploy
  fails without it, independent of whether social/Meta features are used).

## Cloudflare Worker secrets (not in repo)

Set via `wrangler secret put`: `SUPABASE_SERVICE_ROLE_KEY`, `API_SECRET_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`.

**Known template gap:** the runbook's secret list also named `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `DIGITAL_HOME_URL` as secrets, but Cloudflare
rejects setting a secret with the same binding name as an existing `var` —
these three are correctly `vars`-only (matches this repo's own CLAUDE.md).
Skipped setting them as secrets; no functional gap since the vars carry the
same values.

**Known gap:** `RESEND_API_KEY` is not in this repo's `.env.local.example`
or documented secret list, but `src/lib/crm/email.ts` (`sendCrmEmail`,
`notifyOwner`) reads `process.env.RESEND_API_KEY` to send real CRM emails.
Without it, CRM email always runs in safe/simulated mode regardless of the
`safe_mode` setting. Left unset for now — real CRM email send is deferred,
not part of the golden-path plumbing check.

## Supabase data (not in repo)

- Public `images` storage bucket created (article hero images).
- Admin user created via `scripts/create-user.ts`
  (`admin@yourdomain.com` — placeholder identity, auto-confirmed, no real
  inbox needed).
- Seeded two `brand_context` rows via `POST /api/setup`: `cta/links` and
  `identity/author`, both generic placeholder content (no branding).

## Theming mechanism + brand config (template upgrade, still generic)

Backend had no `design-system/tokens.json` at all — added one, mirroring
the Frontend's shape plus a `dashboard` section and a `brand` section (name +
logo letter), and wired the dashboard's existing CSS-variable theming system
to read from it instead of hardcoded values. The dashboard already had a
fairly sophisticated dark/light toggle (shadcn-based, swaps `--color-white`/
`--color-black` and a `--color-minimal-*` palette via an `html:not(.dark)`
override) — this extends that *same, already-working* mechanism to be
config-driven rather than replacing it.

- **`design-system/tokens.json`** (new) — `brand.name`/`brand.logoLetter`,
  `colors.brand.*` (shared shape with Frontend, unused yet — reserved for a
  future shared-brand-accent use), `typography.fontFamily`, and
  `dashboard.dark`/`dashboard.light` (the minimal bg/border/muted/accent/row
  palette plus white/black inversions, for both modes). Values are the
  dashboard's actual current colors — including the `.dark`-scoped
  legibility tuning on `muted`/`row` that the original `@theme` block didn't
  reflect (dark mode is the default, so `tokens.json` had to match what's
  actually rendered, not the pre-tuning base value).
- **`src/lib/theme/tokens.ts`** (new) — same shape as Frontend's:
  `googleFontsHref()` for a config-driven font, and `buildThemeCss()` which
  renders **both** a `:root` block (dark defaults) and an
  `html:not(.dark)` block (light overrides) from `tokens.json`, matching the
  dashboard's existing dark/light selector structure.
- **`src/app/globals.css`** — switched `@theme` to `@theme inline` (needed
  so `var()`-referencing theme values resolve correctly — matches the
  mechanism proven on Frontend). `--color-minimal-*` and `--color-white`/
  `--color-black` now alias to injected `--minimal-*-value`/`--white-value`/
  `--black-value` variables instead of literals. Removed the now-redundant
  literal palette values from the static `html:not(.dark)` block and the
  `.dark` legibility-tuning block (both folded into `tokens.json` as the
  single source of truth) — **kept** the zinc-scale mirroring and the
  red/green/yellow/violet/blue/emerald light-mode tuning as literal values
  (see "flagged" below). `body`'s background/color/font-family now reference
  the injected root variables directly rather than the Tailwind theme name,
  to sidestep any ambiguity in how `@theme inline` resolves values for
  hand-written (non-utility-class) CSS.
- **`src/app/layout.tsx`** — removed the hardcoded `next/font` Geist import
  (same trade-off as Frontend: loses self-hosting, gains genuine
  `tokens.json`-driven font swapping). Injects the theme `<style>` tag and
  Google Fonts `<link>`. Page `<title>` now reads `${brand.name} Platform`
  instead of a hardcoded `"Digital Home Platform"`.
- **Brand name + logo, not just colors:** `src/components/sidebar.tsx` had
  the wordmark **hardcoded as `"Brave"` with a `"B"` logo badge** — this is
  the upstream template author's own brand baked into what's supposed to be
  a neutral base. Replaced with `tokens.json`'s `brand.name`/`brand.logoLetter`
  (currently `"Digital Home"`/`"D"`, still generic). `src/app/login/page.tsx`'s
  heading (already the generic `"Digital Home"`, not `"Brave"`) now also
  reads from the same config, so a client's dashboard shows their name, not
  a hardcoded one.
- **Pass condition verified live**, twice (dark and light mode both
  correctly inherit): changed `tokens.json`'s dark `white` value to a test
  color, confirmed it propagated across the sidebar, nav, pipeline board,
  and buttons with no stragglers, then reverted. Also confirmed the
  light/dark toggle itself still works correctly post-refactor.

**Flagged, not touched — resisted this pass:** the zinc scale (`--color-zinc-*`),
and the semantic status/accent colors (`--color-status-*`,
green/yellow/red/violet/blue/emerald used for pipeline status dots and
badges across CRM/Content/Social/Leads/Pipeline/Funnel/Email — dozens of
files) are **not** wired to `tokens.json`. Judgment call, not an oversight:
these are functional/semantic colors (red = error, green = published), not
brand-identity carriers — a client's "published" status dot shouldn't change
color based on their brand palette any more than a mail client's "unread"
dot would. Rewiring these would also be a much larger effort (every CRM/
pipeline/social page) for near-zero brand value. If a future instance wants
these themed too, that's a deliberate follow-up, not part of this pass.

## Guide tab (template upgrade, generic content)

Added a static "Guide" tab to the dashboard explaining how to run the
Compound — same content for every instance, ships in the base.

- **`src/content/guide.ts`** (new) — the **only** place the guide's wording
  lives, as a single markdown string (`GUIDE_MARKDOWN`). One section each:
  Overview, Leads/CRM, Content pipeline (including safe vs. autonomous
  mode), Social, Bookings, Email & sequences, Automation, Settings. Edit
  this file to change the wording — no component touches copy directly.
- **`src/app/guide/page.tsx`** (new) — renders `GUIDE_MARKDOWN` via `marked`
  (already a dependency, reused from `src/lib/crm/markdown.ts` rather than
  adding a new one) into styled HTML. Styled entirely with Tailwind utility
  classes over the already-token-driven `white`/`zinc-400`/`minimal-muted`
  colors — no new hardcoded values.
- **`src/components/sidebar.tsx`** — added a "Guide" nav entry (using a
  simple question-mark-circle icon). Respects the existing social-role route
  restriction (social-role users are hard-redirected to `/social` by
  middleware regardless of nav visibility, so hiding Guide from their nav is
  consistent with existing behavior, not a new restriction).
- **Static v1 only** — no AI/chat help agent, per the brief. Confirmed the
  tab inherits theme changes live (same pass-condition test as above).

## No other changes

No CRM logic, API routes, or other components have been modified.

---

# INSTANCE LAYER — chadjordan.studio (the Compound)

## design-system/tokens.json (brand — keep instance side on upstream merge)
- Rebranded the admin dashboard to the Compound: navy ground (`#0d1b2e`),
  bone foreground (`#ede8dc`), gold accent (`#c9a96e`), gold-hairline borders;
  Bricolage Grotesque / DM Sans / DM Mono. `brand.name` → "Chad Jordan · Studio",
  `logoLetter` → "C". Same `dashboard.dark/light` key structure preserved so
  `buildThemeCss()` is unaffected. Token pass only — status chips left semantic;
  a handful of hardcoded neutrals in the prose-editor/article-preview remain.

## Image Visual DNA (base upgrade — config-driven, generic)
`src/app/api/write-article/route.ts` — the hero-image prompt builder now wraps
every per-post subject with a brand **Visual DNA** read from `brand_context`
(category `content`): `image_style` is PREPENDED (grade/palette/mood) and
`image_avoid` is APPENDED as a negative list. Previously the style fell back to
a hardcoded off-brand default and there was no config avoid list. The template
default is now a neutral placeholder — each instance sets its own DNA in config,
no code change (same discipline as design tokens). This instance's values are
seeded in `brand_context` (see `content-corpus/content/image_style.md` +
`image_avoid.md`): navy/near-black + single warm gold accent, low-key matte
filmic. Mechanism generic; values per instance.

## Content pipeline admin UX (base upgrade)
`src/app/api/content-calendar/[id]/route.ts` — added `DELETE` to remove a
calendar entry (suggested topic); leaves any written content_object intact.
`src/app/content/page.tsx` — added a **"Run trend scan"** toolbar button
(POSTs `/api/trend-scan` via session auth, refreshes the board) and a
per-card **Remove** action for planned/approved/archived suggestions.
Instance data: seeded `backend_settings.trend_scan_config` with on-brand
domains/audience/terms so the scan proposes ownership/platform-risk topics
instead of the generic `DEFAULT_CONFIG`.

## Social media host (instance)
- Connected custom domain `media.chadjordan.studio` to the `social-media` R2
  bucket (`wrangler r2 bucket domain add`) and set `R2_PUBLIC_BASE` to it in
  `wrangler.jsonc` — Meta/Instagram ingest posted media by pulling that URL.
  Account connection (Meta page token / OAuth) still pending.

## Image Doctrine — literal scenes (instance)
`src/app/api/write-article/route.ts` — realigned the hero-image prompt to the
brand Image Doctrine (literal, never conceptual): the `image_concept` schema
prompt now asks for a literal real moment (figure / trace / environment, figure
in profile eyes-down) instead of a "monumental, surreal SCENE… as a world", and
the fallback subject line asks for a literal moment instead of a "metaphor".
Pairs with the `content/image_style` + `image_avoid` brand_context values.

## Upgrade 2.5.6 → 2.9.0 (branch `codex/upgrade-2.9.0`, 2026-10-26)

Applied as a three-way merge of upstream `v2.5.6..v2.9.0` onto this repo (the
initial commit is v2.5.6 plus theming, so v2.5.6 is the merge base). No
database migration is part of this range.

- `src/app/api/write-article/route.ts` — the custom writer (editing pass,
  contrast checks, subject picker, varied framings) is kept as the core. Added
  from upstream: Playbook projection preflight, active-offers CTA fallback,
  required `article_image_mode` (`automatic` | `text_only`), and the R2
  public-media hero path. A failed hero now holds the article as a draft
  (2.9.0 publication guard) instead of publishing without an image.
- `src/lib/content/image.ts` — `renderImage` takes an optional `"webp"` format;
  the writer uses it. `scripts/regenerate-hero.ts` still renders PNG and uploads
  to Supabase storage: port it to `/api/media/upload` before relying on it,
  because the publish guard blocks legacy Supabase hero URLs.
- `wrangler.jsonc` — kept all instance vars; added `PUBLIC_MEDIA` →
  `chadjordan-public-media` (bucket must be created before deploy) and kept the
  existing `SOCIAL_MEDIA` binding; added `SOCIAL_SCHEDULER_MODE: native`;
  `SOCIAL_PUBLISHING_ENABLED` deliberately left absent (existing calendar kept).
- `src/components/sidebar.tsx` — kept the instance brand name over the stock
  "Digital Home" wordmark; took upstream's new nav entries.
- `package.json` — kept custom scripts, added `test:brand`.
- Removed four obsolete `@ts-expect-error` lines: upstream now enables
  `allowImportingTsExtensions`.
- `scripts/test-article-media.mjs` — test double extended with `.in()` and an
  empty `agent_logs` table so it exercises the custom writer.
- `VERSION` set to `2.9.0` after the verified deploy.

**Deployed 2026-10-26 14:36 UTC** (approved by Chad): Worker `chadjordan-backend`
version `0f90e058-5934-4eaa-836b-6133ff81bc1c` at 100%. Previous version
`73fcf6fa-1921-4607-9502-c04f6d78aff6` (rollback target). Verified: preview and
live media probe (storage, optimisation, public delivery), login 200, brand and
media routes present, signed CRM leads read, Brand Playbook 1.0 published
(7 projection rows, CTA ready). R2 bucket `chadjordan-public-media` created
2026-10-26. `article_image_mode=automatic` and `cta/links` set in brand_context.

Follow-ups: pin `PUBLIC_MEDIA_BASE`; migrate the 2 legacy-hero drafts (and
optionally the 9 published heroes) to R2; port `scripts/regenerate-hero.ts`;
audit frontend direct-publish routes.

## New-lead owner alerts (2026-10-26, not in upstream)

- `src/lib/crm/new-lead-alerts.ts` (+ test): the CRM tick emails the owner
  once per new lead via `notifyOwner`. Watches the `leads` table, so it covers
  the frontend form that inserts directly. Enabled by
  `backend_settings.crm_new_lead_alerts = true`; watermark
  `crm_new_lead_alert_since`. Hooked into `runEngineTick` in `engine.ts`.
- Email: Resend domain `chadjordan.studio` verified 2026-10-26; Worker secret
  `RESEND_API_KEY` set; `crm_sender` = Chad Jordan Studio
  <alerts@chadjordan.studio>, reply-to hello@chadjordan.studio. `crm_safe_mode`
  remains on for lead-facing email.
- Deployed version `9be2bc96-ddbb-40cd-aaa3-cd13f780492a`; alerts enabled
  15:07 UTC.

## Media housekeeping (2026-10-26)

- `PUBLIC_MEDIA_BASE` pinned to `https://chadjordan-backend.chad-1a0.workers.dev/media`.
- `scripts/media-upload.ts` (signed upload helper), `scripts/migrate-hero-to-r2.ts`
  (move an existing hero, log previous URL, keep original);
  `scripts/regenerate-hero.ts` now uploads WebP through the helper.
- Deployed version `919b61b3-cc3f-4aaa-9c99-87779884b4f3` (previous `9be2bc96`).
- Migrated the heroes of 3 drafts to R2 (previous Supabase URLs in agent_logs,
  action `migrate_hero`; originals kept). The 9 published articles still use
  Supabase-hosted heroes; they serve fine and are not blocked.
