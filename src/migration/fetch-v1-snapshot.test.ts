import { describe, expect, test } from "bun:test";
import { fetchV1Snapshot } from "./fetch-v1-snapshot.ts";
import { parseV1Snapshot } from "./snapshot.ts";

describe("V1 Snapshot fetch", () => {
  test("performs the epoch handshake without retaining the bearer token", async () => {
    const requests: Request[] = [];
    const result = await fetchV1Snapshot("http://127.0.0.1:3005", "private-bearer", {
      clock: () => new Date("2026-09-08T10:00:00.000Z"),
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (requests.length === 1) {
          return Response.json({ resetSync: true, epochId: "epoch-one" });
        }
        return Response.json({
          knowledgePoints: [],
          grammarPoints: [],
          srsUpdates: [],
          userPreference: {
            dailyNewRuleLimit: 4,
            learnerTimeZone: "UTC",
          },
        });
      },
    });
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(new URL(requests[1]?.url ?? "").searchParams.get("epochId")).toBe(
      "epoch-one",
    );
    if (!result.ok) throw new Error(result.error.kind);
    expect(new TextDecoder().decode(result.value)).not.toContain("private-bearer");
    expect(parseV1Snapshot(result.value)).toMatchObject({ ok: true });
  });

  test("rejects unsafe origins and authentication failures", async () => {
    const dependencies = {
      clock: () => new Date("2026-09-08T10:00:00.000Z"),
      fetch: async () => new Response(null, { status: 401 }),
    };
    expect(await fetchV1Snapshot("http://example.com", "x", dependencies)).toEqual({
      ok: false,
      error: { kind: "originInvalid" },
    });
    expect(await fetchV1Snapshot("https://example.com", "x", dependencies)).toEqual({
      ok: false,
      error: { kind: "authentication" },
    });
    expect(await fetchV1Snapshot("https://example.com", "", dependencies)).toEqual({
      ok: false,
      error: { kind: "credentialMissing" },
    });
  });

  test("converts a failed clock into a typed result", async () => {
    const result = await fetchV1Snapshot("https://example.com", "private", {
      fetch: async () =>
        Response.json({
          knowledgePoints: [],
          grammarPoints: [],
          srsUpdates: [],
          userPreference: null,
        }),
      clock: () => {
        throw new Error("clock fixture body");
      },
    });
    expect(result).toEqual({
      ok: false,
      error: { kind: "remoteInvalid", detail: "Snapshot clock is invalid." },
    });
  });
});
