import { describe, expect, test } from "bun:test";
import { createPrivateAccess } from "./private-access.ts";

const password = "this-is-a-long-private-password";

const formRequest = (candidate: string, client = "203.0.113.1"): Request =>
  new Request("https://gafu.example/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Forwarded-For": client,
    },
    body: new URLSearchParams({ password: candidate }),
  });

describe("private deployment access", () => {
  test("rejects weak configuration before serving", () => {
    expect(
      createPrivateAccess({
        password: "too-short",
        clock: () => new Date(),
        nextToken: () => "x".repeat(43),
      }),
    ).toMatchObject({ ok: false, error: { kind: "invalidConfiguration" } });
  });

  test("a session outlives the process that issued it", async () => {
    // Sessions lived in a Map, so every deploy signed the owner out. A restart
    // is a fresh createPrivateAccess with the same configured password.
    const now = Date.parse("2026-09-09T00:00:00.000Z");
    const build = (withPassword: string) => {
      const access = createPrivateAccess({
        password: withPassword,
        clock: () => new Date(now),
        nextToken: () => "a".repeat(43),
        sessionTtlMs: 60_000,
      });
      if (!access.ok) throw new Error(access.error.kind);
      return access.value;
    };

    const signIn = await build(password).intercept(formRequest(password));
    if (signIn.kind !== "respond") throw new Error("expected a response");
    const cookie = signIn.response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Host-gafu-session=");
    const carried = cookie.split(";")[0] ?? "";

    const authorized = (access: ReturnType<typeof build>) =>
      access.intercept(
        new Request("https://gafu.example/api/provider", {
          headers: { cookie: carried },
        }),
      );

    // The process that issued it, and a restarted one, both accept it.
    expect(await authorized(build(password))).toEqual({ kind: "continue" });

    // Rotating the password invalidates every outstanding session, which the
    // Map did not do.
    const rotated = await authorized(build("a-different-long-password"));
    expect(rotated.kind).toBe("respond");
    if (rotated.kind === "respond") expect(rotated.response.status).toBe(401);
  });

  test("a tampered or expired session cookie is refused", async () => {
    let now = Date.parse("2026-09-09T00:00:00.000Z");
    const access = createPrivateAccess({
      password,
      clock: () => new Date(now),
      nextToken: () => "a".repeat(43),
      sessionTtlMs: 60_000,
    });
    if (!access.ok) throw new Error(access.error.kind);
    const signIn = await access.value.intercept(formRequest(password));
    if (signIn.kind !== "respond") throw new Error("expected a response");
    const carried =
      (signIn.response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

    const probe = async (cookie: string) =>
      access.value.intercept(
        new Request("https://gafu.example/api/provider", { headers: { cookie } }),
      );

    // Re-signing is the only way to change the expiry the cookie carries.
    const [name, value] = carried.split("=") as [string, string];
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const [token, expiry, signature] = decoded.split(".") as [string, string, string];
    const extended = Buffer.from(
      `${token}.${Number(expiry) + 86_400_000}.${signature}`,
    ).toString("base64url");
    const tampered = await probe(`${name}=${extended}`);
    expect(tampered.kind).toBe("respond");

    expect(await probe(carried)).toEqual({ kind: "continue" });
    now += 120_000;
    const stale = await probe(carried);
    expect(stale.kind).toBe("respond");
  });

  test("protects documents and APIs, then issues one secure private session", async () => {
    let now = Date.parse("2026-09-09T00:00:00.000Z");
    const access = createPrivateAccess({
      password,
      clock: () => new Date(now),
      nextToken: () => "a".repeat(43),
      sessionTtlMs: 60_000,
    });
    if (!access.ok) throw new Error(access.error.kind);

    const document = await access.value.intercept(
      new Request("https://gafu.example/", { redirect: "manual" }),
    );
    expect(document.kind).toBe("respond");
    if (document.kind === "respond") {
      expect(document.response.status).toBe(303);
      expect(document.response.headers.get("location")).toBe("/login");
    }

    const api = await access.value.intercept(
      new Request("https://gafu.example/api/study"),
    );
    expect(api.kind).toBe("respond");
    if (api.kind === "respond") {
      expect(api.response.status).toBe(401);
      expect(await api.response.json()).toEqual({
        error: { kind: "authenticationRequired" },
      });
    }

    const rejected = await access.value.intercept(formRequest("wrong-password"));
    expect(rejected.kind).toBe("respond");
    if (rejected.kind === "respond") expect(rejected.response.status).toBe(401);

    const accepted = await access.value.intercept(formRequest(password));
    expect(accepted.kind).toBe("respond");
    if (accepted.kind !== "respond") return;
    expect(accepted.response.status).toBe(303);
    const setCookie = accepted.response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Host-gafu-session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Strict");
    const cookie = setCookie.split(";")[0] ?? "";

    expect(
      await access.value.intercept(
        new Request("https://gafu.example/api/study", { headers: { cookie } }),
      ),
    ).toEqual({ kind: "continue" });

    now += 60_001;
    const expired = await access.value.intercept(
      new Request("https://gafu.example/api/study", { headers: { cookie } }),
    );
    expect(expired.kind).toBe("respond");
    if (expired.kind === "respond") expect(expired.response.status).toBe(401);
  });

  test("logout revokes a session and repeated failures are throttled per client", async () => {
    const access = createPrivateAccess({
      password,
      clock: () => new Date("2026-09-09T00:00:00.000Z"),
      nextToken: () => "b".repeat(43),
    });
    if (!access.ok) throw new Error(access.error.kind);
    const accepted = await access.value.intercept(formRequest(password));
    if (accepted.kind !== "respond") throw new Error("login was not handled");
    const cookie = (accepted.response.headers.get("set-cookie") ?? "").split(";")[0];

    const logout = await access.value.intercept(
      new Request("https://gafu.example/auth/logout", {
        method: "POST",
        headers: { cookie: cookie ?? "" },
      }),
    );
    expect(logout.kind).toBe("respond");
    if (logout.kind === "respond") {
      expect(logout.response.status).toBe(303);
      expect(logout.response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
    const revoked = await access.value.intercept(
      new Request("https://gafu.example/", { headers: { cookie: cookie ?? "" } }),
    );
    expect(revoked.kind).toBe("respond");

    let finalStatus = 0;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await access.value.intercept(
        formRequest("still-wrong", "198.51.100.20"),
      );
      if (result.kind === "respond") finalStatus = result.response.status;
    }
    expect(finalStatus).toBe(429);
    const blocked = await access.value.intercept(
      formRequest(password, "198.51.100.20"),
    );
    expect(blocked.kind).toBe("respond");
    if (blocked.kind === "respond") {
      expect(blocked.response.status).toBe(429);
      expect(blocked.response.headers.get("retry-after")).not.toBeNull();
    }
  });
});
