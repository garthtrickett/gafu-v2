const processes = [
  Bun.spawn([process.execPath, "--watch", "src/study/server.ts"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  }),
  Bun.spawn([process.execPath, "x", "vite"], {
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  }),
];

const stop = (): void => {
  for (const process of processes) process.kill();
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

await Promise.race(processes.map((process) => process.exited));
stop();
