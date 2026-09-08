import { resolve } from "node:path";
import { inspectHealth } from "../src/reliability/health.ts";

const databasePath = Bun.argv[2];
if (databasePath === undefined) {
  console.error("Usage: bun run health -- <gafu.sqlite>");
  process.exit(2);
}
// Provider keys are intentionally process-memory-only. An offline database
// inspection therefore reports them as unconfigured.
const report = inspectHealth(resolve(databasePath), false);
if (!report.ok) {
  console.error(`Health check failed: ${report.error.kind}`);
  process.exit(1);
}
console.log(JSON.stringify(report.value, null, 2));
