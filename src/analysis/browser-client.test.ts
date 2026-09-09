import { expect, test } from "bun:test";
import { createBrowserAnalysisClient } from "./browser-client.ts";

test("worker failure and close settle current and future analysis", async () => {
  const listeners = new Map<string, (event: Event) => void>();
  let terminated = false;
  const client = createBrowserAnalysisClient(
    () =>
      ({
        addEventListener: (type: string, listener: EventListener) => {
          listeners.set(type, listener);
        },
        postMessage: () => {},
        terminate: () => {
          terminated = true;
        },
      }) as never,
  );
  const current = client.analyzer.analyze("cue", "猫");
  listeners.get("error")?.(new Event("error"));
  expect(await current).toMatchObject({
    ok: false,
    error: { kind: "analyzerUnavailable" },
  });
  expect(await client.analyzer.analyze("later", "犬")).toMatchObject({
    ok: false,
    error: { kind: "analyzerUnavailable" },
  });
  client.close();
  expect(terminated).toBe(true);
});

test("closing settles an outstanding analysis request", async () => {
  const client = createBrowserAnalysisClient(
    () =>
      ({
        addEventListener: () => {},
        postMessage: () => {},
        terminate: () => {},
      }) as never,
  );
  const pending = client.analyzer.analyze("cue", "猫");
  client.close();
  expect(await pending).toMatchObject({
    ok: false,
    error: { kind: "analyzerUnavailable" },
  });
});
