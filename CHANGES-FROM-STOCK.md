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
