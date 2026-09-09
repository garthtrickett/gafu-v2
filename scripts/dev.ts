const viteMode = process.env["GAFU_VITE_MODE"] === "preview" ? "preview" : "dev";
if (viteMode === "preview") {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  const exitCode = await build.exited;
  if (exitCode !== 0) throw new Error(`Gafu browser build failed (${exitCode}).`);
}

const backend = Bun.spawn([process.execPath, "--watch", "src/study/server.ts"], {
  stdout: "inherit",
  stderr: "inherit",
  env: process.env,
});
const processes = [backend];

const stop = (): void => {
  for (const process of processes) process.kill();
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const waitForBackend = async (): Promise<void> => {
  const port = Number(process.env["GAFU_SERVER_PORT"] ?? 42070);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) {
      throw new Error(`Gafu backend exited during startup (${backend.exitCode}).`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      await response.body?.cancel();
      if (backend.exitCode === null) return;
    } catch {
      // The watched backend compiles before it binds its local port.
    }
    await Bun.sleep(25);
  }
  throw new Error("Gafu backend did not become ready within 15 seconds.");
};

try {
  await waitForBackend();
  processes.push(
    Bun.spawn(
      [process.execPath, "x", "vite", ...(viteMode === "preview" ? ["preview"] : [])],
      {
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      },
    ),
  );
  await Promise.race(processes.map((process) => process.exited));
} finally {
  stop();
}
