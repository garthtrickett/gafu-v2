import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireDatabaseLock, databaseLockIsActive } from "./database-lock.ts";

describe("database process lock", () => {
  test("blocks a second owner and safely replaces a stale lock", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-lock-"));
    try {
      const databasePath = join(directory, "gafu.sqlite");
      const first = acquireDatabaseLock(databasePath);
      expect(first.ok).toBe(true);
      expect(databaseLockIsActive(databasePath)).toBe(true);
      expect(acquireDatabaseLock(databasePath)).toEqual({
        ok: false,
        error: "databaseInUse",
      });
      if (first.ok) first.value.release();
      expect(databaseLockIsActive(databasePath)).toBe(false);

      writeFileSync(
        `${databasePath}.lock`,
        JSON.stringify({ pid: 2_147_483_647, token: "stale" }),
      );
      const replacement = acquireDatabaseLock(databasePath);
      expect(replacement.ok).toBe(true);
      if (replacement.ok) replacement.value.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("treats an unreadable lock as in-use instead of racing its owner", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-lock-"));
    try {
      const databasePath = join(directory, "gafu.sqlite");
      writeFileSync(`${databasePath}.lock`, "");
      expect(databaseLockIsActive(databasePath)).toBe(true);
      expect(acquireDatabaseLock(databasePath)).toEqual({
        ok: false,
        error: "databaseInUse",
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("prunes dead directory owners before acquiring", () => {
    const directory = mkdtempSync(join(tmpdir(), "gafu-v2-lock-"));
    try {
      const databasePath = join(directory, "gafu.sqlite");
      const lockDirectory = `${databasePath}.lock`;
      mkdirSync(lockDirectory);
      writeFileSync(
        join(lockDirectory, "dead.json"),
        JSON.stringify({ pid: 2_147_483_647, token: "dead" }),
      );
      expect(databaseLockIsActive(databasePath)).toBe(false);
      const acquired = acquireDatabaseLock(databasePath);
      expect(acquired.ok).toBe(true);
      if (acquired.ok) acquired.value.release();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
