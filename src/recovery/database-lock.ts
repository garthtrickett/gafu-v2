import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
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

export const databaseLockIsActive = (databasePath: string): boolean => {
  const path = lockPath(databasePath);
  if (!existsSync(path)) return false;
  const record = readLock(path);
  // An unreadable lock can be a second process between its exclusive create and
  // record write. Treat it as active rather than opening the database through
  // that race. A genuinely corrupt lock must be removed deliberately.
  return record === null || processIsAlive(record.pid);
};

export const acquireDatabaseLock = (
  databasePath: string,
): Result<DatabaseLock, "databaseInUse" | "lockFailed"> => {
  const path = lockPath(databasePath);
  let descriptor: number | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(path, "wx", 0o600);
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "EEXIST") {
        return err("lockFailed");
      }
      const existing = readLock(path);
      if (existing === null || processIsAlive(existing.pid)) {
        return err("databaseInUse");
      }
      try {
        unlinkSync(path);
      } catch {
        return err("lockFailed");
      }
    }
  }
  if (descriptor === null) return err("lockFailed");
  const token = crypto.randomUUID();
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token }));
    closeSync(descriptor);
    descriptor = null;
  } catch {
    if (descriptor !== null) closeSync(descriptor);
    try {
      unlinkSync(path);
    } catch {
      // The original write failure remains authoritative.
    }
    return err("lockFailed");
  }
  let released = false;
  return ok({
    path,
    release: () => {
      if (released) return;
      released = true;
      const current = readLock(path);
      if (current?.token !== token) return;
      try {
        unlinkSync(path);
      } catch {
        // Process exit will leave an identifiable stale lock, never a false live lock.
      }
    },
  });
};
