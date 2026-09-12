/**
 * Moves the `known` Cards into rotation as graduated review Cards, their first
 * reviews spread over a window of days.
 *
 *   GAFU_ACCESS_PASSWORD=... bun run known:graduate [--days 42] [--commit]
 *
 * Always downloads a backup of the study database first, to ~/gafu-backups.
 * Without --commit it prints the plan and writes nothing.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { LOCAL_MUTATION_HEADER, LOCAL_MUTATION_VALUE } from "../src/local-api.ts";
import type { GraduationPlan } from "../src/study/contracts.ts";

const baseUrl =
  process.env["GAFU_BASE_URL"] ?? "https://gafu-v2-production.up.railway.app";
const password = process.env["GAFU_ACCESS_PASSWORD"] ?? "";
if (password === "") throw new Error("GAFU_ACCESS_PASSWORD is required.");
const arguments_ = process.argv.slice(2);
const daysIndex = arguments_.indexOf("--days");
const spreadDays = daysIndex >= 0 ? Number(arguments_[daysIndex + 1]) : 42;
const commit = arguments_.includes("--commit");
if (!Number.isInteger(spreadDays) || spreadDays < 1)
  throw new Error("--days must be a whole number.");

const signIn = async (): Promise<string> => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = response.headers.get("set-cookie");
  if (cookie === null) throw new Error(`Sign-in failed with HTTP ${response.status}.`);
  return cookie.split(";")[0] ?? "";
};
const cookie = await signIn();

// Backup first, every time: the graduation rewrites hundreds of rows.
const backup = await fetch(`${baseUrl}/api/study/backup`, { headers: { cookie } });
if (!backup.ok) throw new Error(`Backup failed: HTTP ${backup.status}`);
const directory = join(homedir(), "gafu-backups");
mkdirSync(directory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const backupPath = join(directory, `gafu-v2-before-graduate-${stamp}.sqlite`);
writeFileSync(backupPath, new Uint8Array(await backup.arrayBuffer()));
console.log(`Backup saved: ${backupPath}`);

const graduate = async (dryRun: boolean): Promise<GraduationPlan> => {
  const response = await fetch(`${baseUrl}/api/study/known/graduate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_MUTATION_HEADER]: LOCAL_MUTATION_VALUE,
      cookie,
    },
    body: JSON.stringify({ spreadDays, dryRun }),
  });
  const body = (await response.json()) as GraduationPlan | { error: { kind: string } };
  if (!response.ok || "error" in body) {
    throw new Error(`Graduation failed: ${JSON.stringify(body)}`);
  }
  return body;
};

const plan = await graduate(true);
console.log(
  `\nPlan: ${plan.graduated.length} Cards graduate over ${spreadDays} days; ${plan.skipped.length} skipped.`,
);
for (const day of plan.perDay)
  console.log(`  ${day.day}  ${"#".repeat(day.count)} ${day.count}`);
if (plan.skipped.length > 0) {
  console.log("Skipped:");
  for (const item of plan.skipped) console.log(`  ${item.title}: ${item.reason}`);
}
if (!commit) {
  console.log("\nDry run only. Re-run with --commit to apply.");
  process.exit(0);
}
const applied = await graduate(false);
console.log(
  `\nApplied: ${applied.graduated.length} Cards are active review Cards, first due ${applied.perDay[0]?.day ?? "-"} through ${applied.perDay.at(-1)?.day ?? "-"}.`,
);
