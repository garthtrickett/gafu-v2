import { describe, expect, test } from "bun:test";
import { loadDiagnostic, presentDiagnosticError } from "./diagnostic.ts";
import type { Logger } from "./log.ts";

const silentLogger: Logger = { write: () => undefined };

describe("diagnostic action", () => {
  test("returns a typed failure that the route can present", async () => {
    const model = await loadDiagnostic(
      {
        check: async () => {
          throw new Error("fixture analyzer is offline");
        },
      },
      silentLogger,
    );

    expect(model.status).toEqual({
      ok: false,
      error: { kind: "unavailable", cause: "fixture analyzer is offline" },
    });
    if (!model.status.ok) {
      expect(presentDiagnosticError(model.status.error)).toBe(
        "Diagnostic unavailable: fixture analyzer is offline",
      );
    }
  });

  test("presents every declared error variant", () => {
    expect(
      presentDiagnosticError({ kind: "unsupported", capability: "Analyzer" }),
    ).toBe("Analyzer is not supported by this diagnostic build.");
  });
});
