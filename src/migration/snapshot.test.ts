import { describe, expect, test } from "bun:test";
import { v1Snapshot } from "../../tests/fixtures/migration/v1.ts";
import { MAX_V1_SNAPSHOT_BYTES } from "./contracts.ts";
import { parseV1Snapshot } from "./snapshot.ts";

describe("V1 Snapshot", () => {
  test("projects the credential-free final sync contract", () => {
    const result = parseV1Snapshot(v1Snapshot());
    expect(result).toMatchObject({
      ok: true,
      value: {
        progress: { length: 6 },
        preferences: { newCardsPerDay: 7, timeZone: "Australia/Sydney" },
      },
    });
  });

  test("rejects credentials, duplicate IDs, malformed JSON, and oversized input", () => {
    expect(parseV1Snapshot(v1Snapshot({ apiKey: "never" }))).toMatchObject({
      ok: false,
      error: { kind: "snapshotInvalid" },
    });
    const duplicate = JSON.parse(new TextDecoder().decode(v1Snapshot())) as {
      sync: { srsUpdates: unknown[] };
    };
    duplicate.sync.srsUpdates.push(duplicate.sync.srsUpdates[0]);
    expect(
      parseV1Snapshot(new TextEncoder().encode(JSON.stringify(duplicate))),
    ).toMatchObject({ ok: false, error: { kind: "snapshotInvalid" } });
    expect(parseV1Snapshot(new TextEncoder().encode("{"))).toMatchObject({
      ok: false,
      error: { kind: "snapshotInvalid" },
    });
    expect(parseV1Snapshot(new Uint8Array(MAX_V1_SNAPSHOT_BYTES + 1))).toEqual({
      ok: false,
      error: { kind: "snapshotTooLarge", maximumBytes: MAX_V1_SNAPSHOT_BYTES },
    });
  });

  test("rejects missing, mistyped, and unknown snapshot collections", () => {
    const missing = JSON.parse(new TextDecoder().decode(v1Snapshot())) as {
      sync: Record<string, unknown>;
    };
    delete missing.sync["knowledgePoints"];
    expect(
      parseV1Snapshot(new TextEncoder().encode(JSON.stringify(missing))),
    ).toMatchObject({ ok: false, error: { kind: "snapshotInvalid" } });

    const mistyped = JSON.parse(new TextDecoder().decode(v1Snapshot())) as {
      sync: Record<string, unknown>;
    };
    mistyped.sync["srsUpdates"] = {};
    expect(
      parseV1Snapshot(new TextEncoder().encode(JSON.stringify(mistyped))),
    ).toMatchObject({ ok: false, error: { kind: "snapshotInvalid" } });

    const unknown = JSON.parse(new TextDecoder().decode(v1Snapshot())) as Record<
      string,
      unknown
    >;
    unknown["unexpected"] = [];
    expect(
      parseV1Snapshot(new TextEncoder().encode(JSON.stringify(unknown))),
    ).toMatchObject({ ok: false, error: { kind: "snapshotInvalid" } });
  });
});
