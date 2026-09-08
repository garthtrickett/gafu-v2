import { describe, expect, test } from "bun:test";
import { createDevelopmentLogger, type LogRecord } from "./log.ts";

describe("development logger", () => {
  test("redacts nested credentials before writing", () => {
    const records: LogRecord[] = [];
    const logger = createDevelopmentLogger((_level, record) => records.push(record));

    logger.write("info", {
      event: "provider.configured",
      fields: {
        apiKey: "sk-example",
        nested: { authorization: "Bearer private", count: 2 },
      },
    });

    expect(records).toEqual([
      {
        event: "provider.configured",
        fields: {
          apiKey: "[REDACTED]",
          nested: { authorization: "[REDACTED]", count: 2 },
        },
      },
    ]);
  });
});
