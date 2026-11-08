import { closeSync, existsSync, fsyncSync, openSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const pathFor = (databasePath: string) => `${databasePath}.preparation-paused`;
/** Outside the backup: persist before replacing any database file. */
export function pauseRestoredPreparation(databasePath: string): void {
  const fd = openSync(pathFor(databasePath), "w", 0o600);
  try {
    writeSync(fd, "Restored data requires explicit preparation reconciliation.\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const directory = openSync(dirname(databasePath), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
export const preparationIsPaused = (databasePath: string): boolean =>
  existsSync(pathFor(databasePath));
export function resumeRestoredPreparation(databasePath: string): void {
  rmSync(pathFor(databasePath), { force: true });
  const directory = openSync(dirname(databasePath), "r");
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}
