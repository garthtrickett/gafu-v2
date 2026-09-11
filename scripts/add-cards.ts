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
import { createKuromojiAnalyzer } from "../src/analysis/kuromoji-analyzer.ts";
import { loadKuromojiFromDirectory } from "../src/analysis/loaders.ts";
import { LOCAL_MUTATION_HEADER, LOCAL_MUTATION_VALUE } from "../src/local-api.ts";
import { type AuthoredCard, buildTeaching, preview } from "./authored-teaching.ts";

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
    example?: string;
  }>[];
  grammar: readonly Readonly<{
    canonicalForm: string;
    meaning: string;
    formation: string;
    usageNotes: string;
    example?: string;
  }>[];
}>;

const proposal = JSON.parse(readFileSync(file, "utf8")) as Proposal;
type Request = {
  label: string;
  body: { type: "grammar" | "vocabulary"; content: Record<string, unknown> };
  authored: AuthoredCard | null;
};

// `example` teaches the Card; it is not part of the Card, so it is stripped
// from what is stored and carried alongside.
const split = <Content extends { example?: string }>(
  content: Content,
): { stored: Omit<Content, "example">; example: string | undefined } => {
  const { example, ...stored } = content;
  return { stored, example };
};

const requests: Request[] = [
  ...proposal.grammar.map((item) => {
    const { stored, example } = split(item);
    return {
      label: item.canonicalForm,
      body: { type: "grammar" as const, content: stored },
      authored:
        example === undefined
          ? null
          : ({ type: "grammar", ...item, example } as AuthoredCard),
    };
  }),
  ...proposal.vocabulary.map((item) => {
    const { stored, example } = split(item);
    return {
      label: `${item.lemma} (${item.reading})`,
      body: { type: "vocabulary" as const, content: stored },
      authored:
        example === undefined
          ? null
          : ({ type: "vocabulary", ...item, example } as AuthoredCard),
    };
  }),
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

// The validator only accepts a teaching sentence whose supporting language the
// learner already knows, so the same knowledge is checked here before sending.
const studyResponse = await fetch(`${baseUrl}/api/study`, { headers: { cookie } });
if (!studyResponse.ok) throw new Error(`Study read failed: ${studyResponse.status}`);
const study = (await studyResponse.json()) as {
  knowledge: {
    vocabulary: readonly {
      lemma: string;
      reading: string;
      partOfSpeech: string | null;
    }[];
    grammar: readonly { canonicalForm: string }[];
  };
};
const knowledge = {
  vocabulary: study.knowledge.vocabulary,
  grammar: new Set(study.knowledge.grammar.map((item) => item.canonicalForm)),
};
const analyzer = createKuromojiAnalyzer(() =>
  loadKuromojiFromDirectory("node_modules/@faanau/kuromoji/dict"),
);
const counts = { created: 0, existing: 0, failed: 0, taught: 0, untaught: 0 };

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

  if (request.authored === null) {
    counts.untaught += 1;
    continue;
  }
  const cardId = (value as { card?: { id?: string } }).card?.id;
  if (cardId === undefined) {
    counts.untaught += 1;
    console.log("           (no card id returned; first exposure will generate)");
    continue;
  }
  const built = await buildTeaching(analyzer, request.authored, knowledge);
  if ("reason" in built) {
    counts.untaught += 1;
    console.log(`           not taught: ${built.reason}`);
    continue;
  }
  const taught = await fetch(`${baseUrl}/api/study/cards/${cardId}/teaching`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      [LOCAL_MUTATION_HEADER]: LOCAL_MUTATION_VALUE,
      cookie,
    },
    body: JSON.stringify(built.value),
  });
  if (taught.ok) {
    counts.taught += 1;
    console.log(`           taught: ${preview(built.value)}`);
  } else {
    counts.untaught += 1;
    const why = (await taught.json()) as {
      error?: { kind?: string; reasons?: string[] };
    };
    console.log(
      `           not taught: ${why.error?.kind ?? taught.status}` +
        (why.error?.reasons ? ` (${why.error.reasons.join(", ")})` : ""),
    );
  }
}

console.log(
  `\n${counts.created} created, ${counts.existing} already existed, ${counts.failed} failed` +
    `\n${counts.taught} carry an authored first exposure, ${counts.untaught} will generate one`,
);
if (counts.failed > 0) process.exitCode = 1;
