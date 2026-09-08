import { html, type TemplateResult } from "lit-html";
import type { Logger } from "./log.ts";
import { attemptAsync, type Result } from "./result.ts";

export type DiagnosticError =
  | { readonly kind: "unavailable"; readonly cause: string }
  | { readonly kind: "unsupported"; readonly capability: string };

export type DiagnosticStatus = Readonly<{
  message: string;
}>;

export type DiagnosticModel = Readonly<{
  heading: string;
  status: Result<DiagnosticStatus, DiagnosticError>;
}>;

export type DiagnosticProbe = Readonly<{
  check: () => Promise<DiagnosticStatus>;
}>;

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "Unknown diagnostic failure";

export const loadDiagnostic = async (
  probe: DiagnosticProbe,
  logger: Logger,
): Promise<DiagnosticModel> => {
  const status = await attemptAsync(
    probe.check,
    (cause): DiagnosticError => ({
      kind: "unavailable",
      cause: describeCause(cause),
    }),
  );

  logger.write(status.ok ? "info" : "warn", {
    event: status.ok ? "diagnostic.ready" : "diagnostic.failed",
  });

  return { heading: "Gafu V2 diagnostics", status };
};

const assertNever = (value: never): never => {
  throw new Error(`Unhandled diagnostic error: ${JSON.stringify(value)}`);
};

export const presentDiagnosticError = (error: DiagnosticError): string => {
  switch (error.kind) {
    case "unavailable":
      return `Diagnostic unavailable: ${error.cause}`;
    case "unsupported":
      return `${error.capability} is not supported by this diagnostic build.`;
    default:
      return assertNever(error);
  }
};

export const diagnosticView = (model: DiagnosticModel): TemplateResult => html`
  <section class="diagnostic" aria-labelledby="diagnostic-heading">
    <p class="eyebrow">Phase 0</p>
    <h1 id="diagnostic-heading">${model.heading}</h1>
    <p class=${model.status.ok ? "status status--ready" : "status status--error"}>
      ${
        model.status.ok
          ? model.status.value.message
          : presentDiagnosticError(model.status.error)
      }
    </p>
  </section>
`;
