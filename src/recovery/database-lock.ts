import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../result.ts";

type LockRecord = Readonly<{ pid: number; token: string }>;

export type DatabaseLock = Readonly<{
  path: string;
  release: () => void;
}>;

const lockPath = (databasePath: string): string => `${databasePath}.lock`;

const readLock = (path: string): LockRecord | null => {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockRecord>;
    return Number.isSafeInteger(value.pid) &&
      Number(value.pid) > 0 &&
      typeof value.token === "string" &&
      value.token !== ""
      ? { pid: Number(value.pid), token: value.token }
      : null;
  } catch {
    return null;
  }
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
};

const records = (
  directory: string,
): readonly Readonly<{ path: string; record: LockRecord | null }>[] =>
  readdirSync(directory).map((name) => {
    const path = join(directory, name);
    return { path, record: readLock(path) };
  });

const prepareDirectory = (
  path: string,
): Result<void, "databaseInUse" | "lockFailed"> => {
  try {
    mkdirSync(path, { mode: 0o700 });
    return ok(undefined);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "EEXIST") return err("lockFailed");
  }
  try {
    if (lstatSync(path).isDirectory()) return ok(undefined);
  } catch {
    return err("lockFailed");
  }
  // Upgrade the old single-file lock format. Replacing the stale file with a
  // directory makes concurrent takeovers safe: unlink cannot remove a rival's
  // newly-created directory.
  const legacy = readLock(path);
  if (legacy === null || processIsAlive(legacy.pid)) return err("databaseInUse");
  try {
    unlinkSync(path);
    mkdirSync(path, { mode: 0o700 });
    return ok(undefined);
  } catch (cause) {
    if (
      (cause as NodeJS.ErrnoException).code === "EEXIST" &&
      lstatSync(path).isDirectory()
    ) {
      return ok(undefined);
    }
    return err("lockFailed");
  }
};

export const databaseLockIsActive = (databasePath: string): boolean => {
  const path = lockPath(databasePath);
  if (!existsSync(path)) return false;
  try {
    if (!lstatSync(path).isDirectory()) {
      const record = readLock(path);
      return record === null || processIsAlive(record.pid);
    }
    return records(path).some(
      ({ record }) => record === null || processIsAlive(record.pid),
    );
  } catch {
    return true;
  }
};

export const acquireDatabaseLock = (
  databasePath: string,
): Result<DatabaseLock, "databaseInUse" | "lockFailed"> => {
  const path = lockPath(databasePath);
  const prepared = prepareDirectory(path);
  if (!prepared.ok) return prepared;
  try {
    for (const candidate of records(path)) {
      if (candidate.record === null || processIsAlive(candidate.record.pid)) {
        return err("databaseInUse");
      }
      unlinkSync(candidate.path);
    }
  } catch {
    return err("lockFailed");
  }

  const token = crypto.randomUUID();
  const candidatePath = join(path, `${token}.json`);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(candidatePath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    closeSync(descriptor);
    descriptor = null;
    // Simultaneous contenders create distinct files. Exactly one may observe
    // itself alone; everyone observing a rival withdraws instead of guessing.
    const candidates = records(path);
    if (
      candidates.length !== 1 ||
      candidates[0]?.record?.token !== token ||
      candidates[0]?.record?.pid !== process.pid
    ) {
      unlinkSync(candidatePath);
      return err("databaseInUse");
    }
  } catch {
    if (descriptor !== null) closeSync(descriptor);
    try {
      if (existsSync(candidatePath)) unlinkSync(candidatePath);
    } catch {
      // The acquisition failure remains authoritative.
    }
    return err("lockFailed");
  }

  let released = false;
  return ok({
    path,
    release: () => {
      if (released) return;
      released = true;
      const current = readLock(candidatePath);
      if (current?.token !== token || current.pid !== process.pid) return;
      try {
        unlinkSync(candidatePath);
        rmdirSync(path);
      } catch {
        // A surviving directory/candidate is conservative: it can never create
        // a false unlocked state and dead owners are pruned next acquisition.
      }
    },
  });
};
