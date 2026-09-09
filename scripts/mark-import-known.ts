import { resolve } from "node:path";
import { markImportedCardsKnown } from "../src/migration/mark-import-known.ts";

const argument = (name: string): string | null => {
  const index = Bun.argv.indexOf(name);
  return index < 0 ? null : (Bun.argv[index + 1] ?? null);
};

const databasePath = argument("--database");
const importKey = argument("--import-key");
if (
  databasePath === null ||
  importKey === null ||
  !Bun.argv.includes("--confirm-imported-known")
) {
  console.error(
    "Usage: bun run migration:v1:mark-known -- " +
      "--database <gafu.sqlite> --import-key <key> --confirm-imported-known",
  );
  process.exit(2);
}

const result = markImportedCardsKnown({
  databasePath: resolve(databasePath),
  importKey,
  now: new Date(),
});
if (!result.ok) {
  console.error(`Imported-known correction failed: ${result.error.kind}`);
  process.exit(1);
}
console.log(JSON.stringify(result.value, null, 2));
