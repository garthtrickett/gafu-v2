import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openOwnedDataSpike,
  restoreOwnedDataSpike,
  type SpikePlanDraft,
} from "./owned-data-spike.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const draft: SpikePlanDraft = {
  planId: "plan-shirokuma-episode-1",
  cards: [
    {
      canonicalKey: "vocabulary:白熊:しろくま",
      cardType: "vocabulary",
      cueId: "episode-1:001",
      spanStart: 0,
      spanEnd: 2,
    },
    {
      canonicalKey: "grammar:〜ている",
      cardType: "grammar",
      cueId: "episode-1:002",
      spanStart: 4,
      spanEnd: 7,
    },
  ],
};

const empty = {
  plans: 0,
  cards: 0,
  memberships: 0,
  evidence: 0,
  schedules: 0,
};
const committed = {
  plans: 1,
  cards: 2,
  memberships: 2,
  evidence: 2,
  schedules: 2,
};

describe("owned SQLite data-topology spike", () => {
  test("commits the whole representative Plan Draft in one transaction", () => {
    const opened = openOwnedDataSpike(":memory:");
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.commitPlan(draft).ok).toBe(true);
    expect(opened.value.counts()).toEqual(committed);
    opened.value.close();
  });

  test("forced mid-transaction failure creates nothing", () => {
    const opened = openOwnedDataSpike(":memory:");
    if (!opened.ok) throw new Error(opened.error.detail);
    const result = opened.value.commitPlan(draft, "cards");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("commitFailed");
    expect(opened.value.counts()).toEqual(empty);
    opened.value.close();
  });

  test("survives close and reload from the authoritative file", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-data-spike-"));
    directories.push(directory);
    const path = join(directory, "learner.sqlite");
    const first = openOwnedDataSpike(path);
    if (!first.ok) throw new Error(first.error.detail);
    expect(first.value.commitPlan(draft).ok).toBe(true);
    first.value.close();
    const reloaded = openOwnedDataSpike(path);
    if (!reloaded.ok) throw new Error(reloaded.error.detail);
    expect(reloaded.value.counts()).toEqual(committed);
    reloaded.value.close();
  });

  test("a serialized backup restores every representative record", () => {
    const opened = openOwnedDataSpike(":memory:");
    if (!opened.ok) throw new Error(opened.error.detail);
    expect(opened.value.commitPlan(draft).ok).toBe(true);
    const backup = opened.value.backup();
    opened.value.close();
    if (!backup.ok) throw new Error(backup.error.detail);
    expect(backup.value.byteLength).toBeGreaterThan(0);
    const restored = restoreOwnedDataSpike(backup.value);
    if (!restored.ok) throw new Error(restored.error.detail);
    expect(restored.value.counts()).toEqual(committed);
    restored.value.close();
  });
});
