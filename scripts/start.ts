import { startBootstrapOnlyServer } from "../src/deployment/bootstrap-only.ts";

if (process.env["GAFU_BOOTSTRAP_ONLY"] === "1") {
  const started = startBootstrapOnlyServer({
    publicDeployment: process.env["GAFU_PUBLIC_DEPLOYMENT"] === "1",
    password: process.env["GAFU_ACCESS_PASSWORD"] ?? "",
    databasePath: process.env["GAFU_DATABASE_PATH"],
    kaishiPath: process.env["GAFU_KAISHI_SEED_PATH"],
    volumeMountPath: process.env["RAILWAY_VOLUME_MOUNT_PATH"],
    port: Number(process.env["PORT"] ?? process.env["GAFU_SERVER_PORT"] ?? 42070),
  });
  if (!started.ok) {
    throw new Error(`Private data bootstrap failed: ${started.error.detail}`);
  }
  console.info(
    `Gafu V2 private data bootstrap listening on port ${started.value.port}`,
  );
  const close = () => started.value.stop();
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} else {
  await import("../src/study/server.ts");
}
