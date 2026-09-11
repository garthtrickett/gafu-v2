import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readBoundedBody } from "../local-api.ts";
import { err, ok, type Result } from "../result.ts";

const cookieName = "__Host-gafu-session";
const maximumLoginBodyBytes = 2_048;
const maximumTrackedClients = 1_024;
const failureWindowMs = 15 * 60 * 1_000;
const maximumFailuresPerWindow = 5;
const defaultSessionTtlMs = 7 * 24 * 60 * 60 * 1_000;

export type PrivateAccessFailure = Readonly<{
  kind: "invalidConfiguration";
  detail: string;
}>;

export type AccessDecision =
  | Readonly<{ kind: "continue" }>
  | Readonly<{ kind: "respond"; response: Response }>;

export type PrivateAccess = Readonly<{
  intercept: (request: Request) => Promise<AccessDecision>;
}>;

export type PrivateAccessDependencies = Readonly<{
  password: string;
  clock: () => Date;
  nextToken: () => string;
  sessionTtlMs?: number;
}>;

type FailedAttempts = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number;
};

const digest = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

const secureHeaders = (): Headers =>
  new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; " +
      "frame-ancestors 'none'; base-uri 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });

const loginPage = (message: string, status = 200): Response => {
  const headers = secureHeaders();
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Gafu V2 sign in</title>
    <style>
      :root { color-scheme: dark; font-family: system-ui, sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #111216; color: #f5f5f7; }
      main { width: min(24rem, calc(100vw - 3rem)); padding: 2rem; border: 1px solid #34363e; border-radius: 1rem; background: #1a1b20; }
      h1 { margin-top: 0; }
      label { display: grid; gap: .5rem; color: #c9cad1; }
      input, button { box-sizing: border-box; width: 100%; min-height: 2.75rem; margin-top: .75rem; border-radius: .5rem; font: inherit; }
      input { border: 1px solid #4b4e58; padding: .65rem .75rem; background: #101115; color: inherit; }
      button { border: 0; background: #18a875; color: #07140f; font-weight: 700; cursor: pointer; }
      p { min-height: 1.5rem; color: #ffabb8; }
    </style>
  </head>
  <body>
    <main>
      <h1>Gafu V2</h1>
      <form method="post" action="/auth/login">
        <label>Private access password
          <input name="password" type="password" required autofocus autocomplete="current-password" maxlength="512">
        </label>
        <button type="submit">Sign in</button>
      </form>
      <p role="alert">${message}</p>
    </main>
  </body>
</html>`,
    { status, headers },
  );
};

const redirect = (location: string, cookie?: string): Response => {
  const headers = secureHeaders();
  headers.set("Location", location);
  if (cookie !== undefined) headers.set("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
};

const sessionCookie = (token: string, ttlMs: number): string =>
  `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; ` +
  `Max-Age=${Math.floor(ttlMs / 1_000)}`;

const expiredCookie = (): string =>
  `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

const cookieValue = (request: Request): string | null => {
  const cookie = request.headers.get("cookie");
  if (cookie === null) return null;
  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    const value = part.slice(separator + 1).trim();
    return value === "" ? null : value;
  }
  return null;
};

const clientKey = (request: Request): string => {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded !== undefined && forwarded !== "" && forwarded.length <= 200
    ? forwarded
    : "unknown-client";
};

const jsonUnauthorized = (): Response => {
  const headers = secureHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify({ error: { kind: "authenticationRequired" } }), {
    status: 401,
    headers,
  });
};

export const createPrivateAccess = (
  dependencies: PrivateAccessDependencies,
): Result<PrivateAccess, PrivateAccessFailure> => {
  const passwordLength = new TextEncoder().encode(dependencies.password).byteLength;
  const sessionTtlMs = dependencies.sessionTtlMs ?? defaultSessionTtlMs;
  if (passwordLength < 16 || passwordLength > 512) {
    return err({
      kind: "invalidConfiguration",
      detail: "The private access password must be 16–512 UTF-8 bytes.",
    });
  }
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 60_000) {
    return err({
      kind: "invalidConfiguration",
      detail: "The private access session lifetime is invalid.",
    });
  }

  const expectedPassword = digest(dependencies.password);
  // Sessions used to live in a Map, so every restart signed everyone out and a
  // deploy cost a login. The cookie now carries its own expiry and a signature
  // over it, keyed off the configured password, so a fresh process recognises
  // a session it never issued. Rotating the password invalidates every
  // outstanding session, which the Map did not do.
  const sessionKey = createHmac("sha256", dependencies.password)
    .update("gafu-session-key-v1")
    .digest();
  const sign = (payload: string): string =>
    createHmac("sha256", sessionKey).update(payload).digest("base64url");
  const issue = (token: string, expiresAt: number): string => {
    const payload = `${token}.${expiresAt}`;
    return Buffer.from(`${payload}.${sign(payload)}`).toString("base64url");
  };
  const openSession = (cookie: string, observedAt: number): string | null => {
    const decoded = Buffer.from(cookie, "base64url").toString("utf8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [token, expiry, signature] = parts as [string, string, string];
    const expected = sign(`${token}.${expiry}`);
    if (signature.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const expiresAt = Number(expiry);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= observedAt) return null;
    return token;
  };
  // Logout still revokes immediately, for as long as this process lives. A
  // restart forgets it, so a signed-out cookie would be honoured again until
  // its expiry; the cookie is cleared, so that needs the cookie to have been
  // captured before signing out.
  const revoked = new Map<string, number>();
  const failedAttempts = new Map<string, FailedAttempts>();

  const now = (): number | null => {
    try {
      const value = dependencies.clock().getTime();
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  const prune = (observedAt: number): void => {
    for (const [key, expiresAt] of revoked) {
      if (expiresAt <= observedAt) revoked.delete(key);
    }
    for (const [key, attempt] of failedAttempts) {
      if (
        attempt.blockedUntil <= observedAt &&
        attempt.windowStartedAt + failureWindowMs <= observedAt
      ) {
        failedAttempts.delete(key);
      }
    }
    while (failedAttempts.size > maximumTrackedClients) {
      const oldest = failedAttempts.keys().next().value;
      if (oldest === undefined) break;
      failedAttempts.delete(oldest);
    }
  };

  const authenticatedToken = (request: Request, observedAt: number): string | null => {
    const cookie = cookieValue(request);
    if (cookie === null) return null;
    const token = openSession(cookie, observedAt);
    if (token === null) return null;
    return revoked.has(digest(token).toString("hex")) ? null : token;
  };

  const login = async (request: Request, observedAt: number): Promise<Response> => {
    const key = clientKey(request);
    const previous = failedAttempts.get(key);
    if (previous !== undefined && previous.blockedUntil > observedAt) {
      const response = loginPage("Too many attempts. Try again later.", 429);
      response.headers.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((previous.blockedUntil - observedAt) / 1_000))),
      );
      return response;
    }
    const contentType = request.headers.get("content-type")?.toLocaleLowerCase();
    if (contentType?.startsWith("application/x-www-form-urlencoded") !== true) {
      return loginPage("The sign-in request was invalid.", 400);
    }
    const body = await readBoundedBody(request, maximumLoginBodyBytes);
    if (!body.ok) return loginPage("The sign-in request was invalid.", 400);
    let candidate = "";
    try {
      candidate =
        new URLSearchParams(
          new TextDecoder("utf-8", { fatal: true }).decode(body.value),
        ).get("password") ?? "";
    } catch {
      return loginPage("The sign-in request was invalid.", 400);
    }
    const candidateDigest = digest(candidate);
    if (!timingSafeEqual(expectedPassword, candidateDigest)) {
      const active =
        previous === undefined ||
        previous.windowStartedAt + failureWindowMs <= observedAt
          ? { failures: 0, windowStartedAt: observedAt, blockedUntil: 0 }
          : previous;
      active.failures += 1;
      if (active.failures >= maximumFailuresPerWindow) {
        active.blockedUntil = observedAt + failureWindowMs;
      }
      failedAttempts.delete(key);
      failedAttempts.set(key, active);
      return active.blockedUntil > observedAt
        ? loginPage("Too many attempts. Try again later.", 429)
        : loginPage("That password was not accepted.", 401);
    }

    failedAttempts.delete(key);
    let token: string;
    try {
      token = dependencies.nextToken();
    } catch {
      return loginPage("Sign-in is temporarily unavailable.", 503);
    }
    if (!/^[A-Za-z0-9_-]{32,512}$/u.test(token)) {
      return loginPage("Sign-in is temporarily unavailable.", 503);
    }
    const expiresAt = observedAt + sessionTtlMs;
    return redirect("/", sessionCookie(issue(token, expiresAt), sessionTtlMs));
  };

  return ok({
    intercept: async (request) => {
      const observedAt = now();
      if (observedAt === null) {
        return {
          kind: "respond",
          response: new Response("Service unavailable", { status: 503 }),
        };
      }
      prune(observedAt);
      const path = new URL(request.url).pathname;
      const authenticated = authenticatedToken(request, observedAt);
      if (path === "/login") {
        if (request.method !== "GET" && request.method !== "HEAD") {
          return { kind: "respond", response: new Response(null, { status: 405 }) };
        }
        return {
          kind: "respond",
          response: authenticated === null ? loginPage("") : redirect("/"),
        };
      }
      if (path === "/auth/login") {
        return {
          kind: "respond",
          response:
            request.method === "POST"
              ? await login(request, observedAt)
              : new Response(null, { status: 405 }),
        };
      }
      if (path === "/auth/logout") {
        if (request.method !== "POST") {
          return { kind: "respond", response: new Response(null, { status: 405 }) };
        }
        const cookie = cookieValue(request);
        const token = cookie === null ? null : openSession(cookie, observedAt);
        if (token !== null) {
          revoked.set(digest(token).toString("hex"), observedAt + sessionTtlMs);
        }
        return { kind: "respond", response: redirect("/login", expiredCookie()) };
      }
      if (authenticated !== null) return { kind: "continue" };
      return {
        kind: "respond",
        response: path.startsWith("/api/") ? jsonUnauthorized() : redirect("/login"),
      };
    },
  });
};
