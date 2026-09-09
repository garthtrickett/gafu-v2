import { describe, expect, test } from "bun:test";
import { startBootstrapOnlyServer } from "./bootstrap-only.ts";

const availablePort = (): number => {
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response(null),
  });
  const port = reservation.port;
  void reservation.stop(true);
  if (port === undefined) throw new Error("Bun did not allocate a test port.");
  return port;
};

const validConfiguration = () => ({
  publicDeployment: true,
  password: "a-private-bootstrap-password",
  databasePath: "/data/gafu-v2.sqlite",
  kaishiPath: "/data/kaishi-1.5k.local.json",
  volumeMountPath: "/data",
  port: availablePort(),
});

describe("private volume bootstrap server", () => {
  test("serves only its health check while learner data is being installed", async () => {
    const started = startBootstrapOnlyServer(validConfiguration());
    if (!started.ok) throw new Error(started.error.detail);
    const origin = `http://127.0.0.1:${started.value.port}`;
    try {
      const health = await fetch(`${origin}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "bootstrap" });
      expect(health.headers.get("cache-control")).toBe("no-store");

      for (const path of ["/", "/login", "/api/study"]) {
        const response = await fetch(`${origin}${path}`, { redirect: "manual" });
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(await response.text()).not.toContain("Card");
      }
    } finally {
      started.value.stop();
    }
  });

  test("refuses bootstrap mode outside the exact private deployment boundary", () => {
    expect(
      startBootstrapOnlyServer({
        ...validConfiguration(),
        publicDeployment: false,
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidConfiguration" } });
    expect(
      startBootstrapOnlyServer({
        ...validConfiguration(),
        databasePath: "/tmp/gafu-v2.sqlite",
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidConfiguration" } });
    expect(
      startBootstrapOnlyServer({
        ...validConfiguration(),
        password: "too-short",
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidConfiguration" } });
  });
});
