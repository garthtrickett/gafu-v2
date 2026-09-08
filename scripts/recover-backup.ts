import { createBackupRecovery } from "../src/recovery/backup.ts";

const usage = (): never => {
  console.error(
    "Usage: bun run backup:inspect -- <backup.sqlite>\n" +
      "   or: bun run backup:restore -- <backup.sqlite> <destination.sqlite> --confirm-replace",
  );
  process.exit(2);
};

const [operation, sourcePath, destinationPath, confirmation] = process.argv.slice(2);
if ((operation !== "inspect" && operation !== "restore") || sourcePath === undefined) {
  usage();
}

const recovery = createBackupRecovery({
  clock: () => new Date(),
  nextToken: () => crypto.randomUUID(),
});

if (operation === "inspect") {
  const result = recovery.inspect(sourcePath);
  if (!result.ok) {
    console.error(`Backup inspection failed: ${result.error.kind}`);
    process.exit(1);
  }
  console.log(JSON.stringify(result.value, null, 2));
  process.exit(0);
}

if (destinationPath === undefined || confirmation !== "--confirm-replace") usage();
const result = recovery.restore({
  sourcePath,
  destinationPath,
  confirmation: "replace",
});
if (!result.ok) {
  console.error(`Backup restore failed: ${result.error.kind}`);
  if ("safetyCopyPath" in result.error && result.error.safetyCopyPath !== null) {
    console.error(`Pre-restore safety copy: ${result.error.safetyCopyPath}`);
  }
  process.exit(1);
}
console.log(JSON.stringify(result.value, null, 2));
