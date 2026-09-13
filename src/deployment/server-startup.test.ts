import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JapaneseAnalyzer } from "../analysis/contracts.ts";
import { ok } from "../result.ts";
import { compileKaishiCompactPool } from "../study/kaishi-seed.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const seedAnalyzer: JapaneseAnalyzer = {
  name: "deployment-seed-fixture",
  analyze: async (cueId, rawText) =>
    ok({
      cueId,
      rawText,
      normalizedText: rawText,
      normalization: "nfkc-v1",
      spanUnit: "utf16-code-unit",
      rawBoundaryByNormalizedCodeUnit: [0, 1],
      tokens: [
        {
          surface: rawText,
          lemma: rawText,
          reading: "ねこ",
          broadPartOfSpeech: "noun",
          partOfSpeech: [],
          conjugation: null,
          span: {
            start: 0,
            end: rawText.length,
            unit: "utf16-code-unit",
            normalization: "nfkc-v1",
          },
          dictionaryFormFound: true,
          senseCandidates: [],
        },
      ],
    }),
};

const availablePort = (): number => {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null),
  });
  const port = reservation.port;
  void reservation.stop(true);
  if (port === undefined) throw new Error("Bun did not allocate a test port.");
  return port;
};

describe("public deployment composition", () => {
  test("refuses public startup without an attached-volume database", async () => {
    const environment: Record<string, string | undefined> = {
      ...process.env,
      GAFU_PUBLIC_DEPLOYMENT: "1",
    };
    delete environment["GAFU_DATABASE_PATH"];
    delete environment["GAFU_KAISHI_SEED_PATH"];
    delete environment["RAILWAY_VOLUME_MOUNT_PATH"];
    const child = Bun.spawn([process.execPath, "run", "scripts/start.ts"], {
      cwd: process.cwd(),
      env: environment,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await child.exited;
    const error = await new Response(child.stderr).text();
    expect(exitCode).not.toBe(0);
    expect(error).toContain(
      "Public deployment requires GAFU_DATABASE_PATH inside the attached Railway volume.",
    );
  });

  test("starts a data-blind bootstrap boundary before private files exist", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-bootstrap-"));
    temporaryDirectories.push(directory);
    const port = availablePort();
    const child = Bun.spawn([process.execPath, "run", "scripts/start.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GAFU_PUBLIC_DEPLOYMENT: "1",
        GAFU_BOOTSTRAP_ONLY: "1",
        GAFU_ACCESS_PASSWORD: "a-secure-deployment-password",
        GAFU_DATABASE_PATH: join(directory, "missing.sqlite"),
        GAFU_KAISHI_SEED_PATH: join(directory, "missing-kaishi.json"),
        PORT: String(port),
        RAILWAY_VOLUME_MOUNT_PATH: directory,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const origin = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 5_000;
      let health: Response | null = null;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          health = await fetch(`${origin}/healthz`);
          break;
        } catch {
          await Bun.sleep(25);
        }
      }
      expect(health?.status).toBe(200);
      expect(await health?.json()).toEqual({ status: "bootstrap" });
      expect((await fetch(`${origin}/`)).status).toBe(503);
      expect((await fetch(`${origin}/api/study`)).status).toBe(503);
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
  });

  test("starts only with volume-backed data and protects the real Study route", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-deployment-"));
    temporaryDirectories.push(directory);
    const seed = await compileKaishiCompactPool(["猫 - cat"], seedAnalyzer);
    if (!seed.ok) throw new Error(seed.error.kind);
    const seedPath = join(directory, "kaishi.json");
    const databasePath = join(directory, "gafu.sqlite");
    writeFileSync(seedPath, JSON.stringify(seed.value.manifest));
    const port = availablePort();
    const child = Bun.spawn([process.execPath, "run", "scripts/start.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        GAFU_PUBLIC_DEPLOYMENT: "1",
        GAFU_ACCESS_PASSWORD: "a-secure-deployment-password",
        GAFU_DATABASE_PATH: databasePath,
        GAFU_KAISHI_SEED_PATH: seedPath,
        GAFU_FAKE_AI: "1",
        OPENAI_API_KEY: "",
        PORT: String(port),
        RAILWAY_VOLUME_MOUNT_PATH: directory,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      const origin = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + 15_000;
      let healthy = false;
      while (Date.now() < deadline && child.exitCode === null) {
        try {
          const response = await fetch(`${origin}/healthz`);
          healthy = response.ok;
          await response.body?.cancel();
          if (healthy) break;
        } catch {
          await Bun.sleep(25);
        }
      }
      if (!healthy) {
        child.kill("SIGTERM");
        const error = await new Response(child.stderr).text();
        throw new Error(`deployment server did not become healthy: ${error}`);
      }

      const denied = await fetch(`${origin}/api/study`);
      expect(denied.status).toBe(401);
      expect(await denied.json()).toEqual({
        error: { kind: "authenticationRequired" },
      });

      const login = await fetch(`${origin}/auth/login`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password: "a-secure-deployment-password" }),
      });
      expect(login.status).toBe(303);
      const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
      expect(cookie).toContain("__Host-gafu-session=");

      const study = await fetch(`${origin}/api/study`, {
        headers: { cookie: cookie ?? "" },
      });
      expect(study.status).toBe(200);
      // The bank snapshot carries only the baseline summary; the words
      // themselves are behind their own route, also login-gated.
      expect(await study.json()).toMatchObject({
        status: { stagedCount: 0 },
        baseline: { availability: "available", enabledCount: 1 },
      });
      const knowledge = await fetch(`${origin}/api/study/knowledge`, {
        headers: { cookie: cookie ?? "" },
      });
      expect(knowledge.status).toBe(200);
      expect(await knowledge.json()).toMatchObject({
        baseline: { availability: "available", enabledCount: 1, entries: [{}] },
      });
    } finally {
      child.kill("SIGTERM");
      await child.exited;
    }
  }, 20_000);
});
