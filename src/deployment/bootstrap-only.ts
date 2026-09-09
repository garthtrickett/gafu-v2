import { isAbsolute, relative, resolve } from "node:path";
import { err, ok, type Result } from "../result.ts";

export type BootstrapOnlyFailure = Readonly<{
  kind: "invalidConfiguration" | "listenFailed";
  detail: string;
}>;

export type BootstrapOnlyServer = Readonly<{
  port: number;
  stop: () => void;
}>;

export type BootstrapOnlyConfiguration = Readonly<{
  publicDeployment: boolean;
  password: string;
  databasePath: string | undefined;
  kaishiPath: string | undefined;
  volumeMountPath: string | undefined;
  port: number;
}>;

const inside = (mountPath: string, targetPath: string): boolean => {
  if (!isAbsolute(mountPath) || !isAbsolute(targetPath)) return false;
  const relation = relative(resolve(mountPath), resolve(targetPath));
  return relation !== "" && !relation.startsWith("..") && !isAbsolute(relation);
};

export const startBootstrapOnlyServer = (
  configuration: BootstrapOnlyConfiguration,
): Result<BootstrapOnlyServer, BootstrapOnlyFailure> => {
  const passwordBytes = new TextEncoder().encode(configuration.password).byteLength;
  if (
    !configuration.publicDeployment ||
    passwordBytes < 16 ||
    passwordBytes > 512 ||
    configuration.databasePath === undefined ||
    configuration.kaishiPath === undefined ||
    configuration.volumeMountPath === undefined ||
    !inside(configuration.volumeMountPath, configuration.databasePath) ||
    !inside(configuration.volumeMountPath, configuration.kaishiPath) ||
    !Number.isSafeInteger(configuration.port) ||
    configuration.port < 1 ||
    configuration.port > 65_535
  ) {
    return err({
      kind: "invalidConfiguration",
      detail:
        "Bootstrap-only startup requires public mode, a private password, " +
        "volume-contained data paths, and a valid port.",
    });
  }

  try {
    const server = Bun.serve({
      hostname: "0.0.0.0",
      port: configuration.port,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path === "/healthz") {
          return request.method === "GET" || request.method === "HEAD"
            ? Response.json(
                { status: "bootstrap" },
                { headers: { "Cache-Control": "no-store" } },
              )
            : new Response(null, { status: 405 });
        }
        return new Response("Service unavailable during private data bootstrap.", {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    });
    return ok({
      port: server.port ?? configuration.port,
      stop: () => {
        void server.stop(true);
      },
    });
  } catch (cause) {
    return err({
      kind: "listenFailed",
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  }
};
