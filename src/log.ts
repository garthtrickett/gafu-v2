export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogRecord = Readonly<{
  event: string;
  fields?: Readonly<Record<string, unknown>>;
}>;

export type Logger = Readonly<{
  write: (level: LogLevel, record: LogRecord) => void;
}>;

const secretKey = /authorization|cookie|credential|password|secret|token|api[-_]?key/i;

export const redactLogValue = (value: unknown, key = ""): unknown => {
  if (secretKey.test(key)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLogValue(item));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactLogValue(childValue, childKey),
      ]),
    );
  }

  return value;
};

export const createDevelopmentLogger = (
  sink: (level: LogLevel, record: LogRecord) => void,
): Logger => ({
  write: (level, record) => {
    sink(level, {
      event: record.event,
      ...(record.fields === undefined
        ? {}
        : {
            fields: redactLogValue(record.fields) as Readonly<Record<string, unknown>>,
          }),
    });
  },
});
