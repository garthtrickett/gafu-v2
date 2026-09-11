/**
 * Creates the Cards in a reviewed proposal file.
 *
 *   GAFU_ACCESS_PASSWORD=... bun run cards:add /path/to/cards.json [--dry-run]
 *
 * Posts through the same HTTP route the browser uses, so canonical identity,
 * deduplication and scheduling are decided by Study rather than bypassed. The
 * proposal file is read from wherever it is given and is expected to live
 * outside the repository, because its usage notes quote subtitle text.
 *
 * Creating a Card that already exists is reported by Study as `existing`, so
 * re-running is safe and is the way to resume a partial run.
 */
import { readFileSync } from "node:fs";
import { LOCAL_MUTATION_HEADER, LOCAL_MUTATION_VALUE } from "../src/local-api.ts";

const baseUrl =
  process.env["GAFU_BASE_URL"] ?? "https://gafu-v2-production.up.railway.app";
const password = process.env["GAFU_ACCESS_PASSWORD"] ?? "";
const [file] = process.argv.slice(2).filter((argument) => argument !== "--dry-run");
const dryRun = process.argv.includes("--dry-run");

if (file === undefined) throw new Error("Pass the proposal file.");
if (password === "" && !dryRun) throw new Error("GAFU_ACCESS_PASSWORD is required.");

type Proposal = Readonly<{
  vocabulary: readonly Readonly<{
    lemma: string;
    reading: string;
    partOfSpeech: string;
    meaning: string;
    usageNotes: string;
  }>[];
  grammar: readonly Readonly<{
    canonicalForm: string;
    meaning: string;
    formation: string;
    usageNotes: string;
  }>[];
}>;

const proposal = JSON.parse(readFileSync(file, "utf8")) as Proposal;
const requests = [
  ...proposal.grammar.map((content) => ({
    label: content.canonicalForm,
    body: { type: "grammar" as const, content },
  })),
  ...proposal.vocabulary.map((content) => ({
    label: `${content.lemma} (${content.reading})`,
    body: { type: "vocabulary" as const, content },
  })),
];

console.log(
  `${requests.length} Cards from ${file}${dryRun ? " — dry run, nothing sent" : ""}`,
);
if (dryRun) {
  for (const request of requests)
    console.log(`  ${request.body.type.padEnd(10)} ${request.label}`);
  process.exit(0);
}

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
const counts = { created: 0, existing: 0, failed: 0 };

for (const request of requests) {
  const response = await fetch(`${baseUrl}/api/study/cards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_MUTATION_HEADER]: LOCAL_MUTATION_VALUE,
      cookie,
    },
    body: JSON.stringify(request.body),
  });
  const value = (await response.json()) as {
    outcome?: string;
    error?: { kind?: string; detail?: string };
  };
  if (!response.ok) {
    counts.failed += 1;
    console.log(
      `  FAILED   ${request.label}: ${value.error?.detail ?? value.error?.kind ?? response.status}`,
    );
    continue;
  }
  const outcome = value.outcome === "existing" ? "existing" : "created";
  counts[outcome] += 1;
  console.log(`  ${outcome.padEnd(8)} ${request.label}`);
}

console.log(
  `\n${counts.created} created, ${counts.existing} already existed, ${counts.failed} failed`,
);
if (counts.failed > 0) process.exitCode = 1;
