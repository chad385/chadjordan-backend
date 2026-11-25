/**
 * Write brand/playbook.json into backend_settings as brand_playbook:current
 * and project it into brand_context.
 *
 * Default is a dry run. It prints the plan and does not connect.
 *
 *   node --experimental-strip-types scripts/seed-brand-playbook.ts
 *
 * Apply only against the Supabase project in the environment you intend to
 * update. This does not deploy the app.
 *
 *   node --env-file=.env.local --experimental-strip-types scripts/seed-brand-playbook.ts --apply
 *
 * The same shelf can also be published later through
 * `node scripts/publish-brand-playbook.mjs publish` once the backend is up.
 * Do not run either against production unless you mean to replace the live playbook.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRAND_ARCHIVE_PREFIX,
  BRAND_CURRENT_KEY,
  comparePlaybookProjection,
  isEnvelope,
  planPlaybookPublish,
  projectPlaybookToBrandContext,
  validatePlaybook,
} from "../src/lib/brand/playbook-contract.ts";
import type { Playbook } from "../brand/playbooks/index.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apply = process.argv.includes("--apply");
const playbook = JSON.parse(readFileSync(resolve(root, "brand/playbook.json"), "utf8")) as Playbook;
const errors = validatePlaybook(playbook);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

const proof = playbook.narrative?.proofAsset?.body.split("\n")[0] || "";
console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  key: BRAND_CURRENT_KEY,
  client: playbook.meta.client,
  version: playbook.meta.version,
  generatedAt: playbook.meta.generatedAt,
  audience: playbook.meta.selectedAudience.title,
  offer: playbook.offerCore.offerStatement.finalStatement,
  proof,
  projection_keys: projectPlaybookToBrandContext(playbook).map((row) => row.key),
}, null, 2));

if (!apply) {
  console.log("Dry run only. Pass --apply to write backend_settings and brand_context.");
  process.exit(0);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to apply.");
  process.exit(1);
}

applyPlaybook(url, serviceKey).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

async function applyPlaybook(url: string, serviceKey: string) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const { data: existingRow, error: readError } = await supabase
    .from("backend_settings")
    .select("value")
    .eq("key", BRAND_CURRENT_KEY)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  const existing = isEnvelope(existingRow?.value) ? existingRow.value : undefined;
  const plan = planPlaybookPublish({
    next: playbook,
    existing,
    actor: "seed:brand-playbook",
    now,
  });

  if (plan.changed && plan.archive) {
    const { error } = await supabase.from("backend_settings").upsert({
      key: `${BRAND_ARCHIVE_PREFIX}${plan.archive.slug}`,
      value: plan.archive,
      updated_at: now,
    }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    console.log(`Archived previous playbook as ${plan.archive.slug}`);
  }

  if (plan.changed) {
    const { error } = await supabase.from("backend_settings").upsert({
      key: BRAND_CURRENT_KEY,
      value: plan.current,
      updated_at: now,
    }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    console.log(`Wrote ${BRAND_CURRENT_KEY}`);
  } else {
    console.log(`${BRAND_CURRENT_KEY} already matches this file.`);
  }

  const projection = projectPlaybookToBrandContext(playbook);
  const { error: projectionError } = await supabase.from("brand_context").upsert(
    projection.map((row) => ({ ...row, updated_at: now })),
    { onConflict: "key" }
  );
  if (projectionError) throw new Error(projectionError.message);
  const check = comparePlaybookProjection(playbook, projection);
  console.log(JSON.stringify({ projection_ready: check.ready, fingerprint: check.fingerprint }, null, 2));
}
