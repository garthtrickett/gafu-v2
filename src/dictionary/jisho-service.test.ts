import { describe, expect, test } from "bun:test";
import { createJishoDictionary, JISHO_SEARCH_ENDPOINT } from "./jisho-service.ts";

const upstream = (slug: string) =>
  Response.json({
    data: [{ slug, senses: [{ english_definitions: ["a dog"] }] }],
  });

const harness = (respond: (input: string) => Promise<Response> | Response) => {
  const calls: string[] = [];
  let clock = 1_000_000;
  const dictionary = createJishoDictionary({
    fetch: async (input) => {
      calls.push(input);
      return respond(input);
    },
    now: () => clock,
    timeoutMs: 50,
  });
  return { dictionary, calls, advance: (ms: number) => (clock += ms) };
};

describe("proxying one search to jisho.org", () => {
  test("normalises the term before it is sent, so punctuation never reaches jisho", async () => {
    const { dictionary, calls } = harness(() => upstream("犬"));
    const result = await dictionary.lookup("「犬」");
    expect(result).toEqual({
      ok: true,
      value: {
        term: "犬",
        entries: [
          {
            slug: "犬",
            isCommon: false,
            jlpt: [],
            forms: [],
            senses: [
              {
                englishDefinitions: ["a dog"],
                partsOfSpeech: [],
                tags: [],
                seeAlso: [],
              },
            ],
          },
        ],
      },
    });
    expect(calls).toEqual([
      `${JISHO_SEARCH_ENDPOINT}?keyword=${encodeURIComponent("犬")}`,
    ]);
  });

  test("a non-Japanese selection is refused with zero upstream calls", async () => {
    const { dictionary, calls } = harness(() => upstream("x"));
    expect(await dictionary.lookup("in use")).toEqual({
      ok: false,
      error: { kind: "invalidTerm" },
    });
    expect(calls).toEqual([]);
  });

  test("a repeated lookup is served from cache until it expires", async () => {
    const { dictionary, calls, advance } = harness(() => upstream("犬"));
    await dictionary.lookup("犬");
    await dictionary.lookup("犬");
    expect(calls).toHaveLength(1);
    advance(6 * 60 * 60 * 1000 + 1);
    await dictionary.lookup("犬");
    expect(calls).toHaveLength(2);
  });

  test("an upstream failure is reported and never cached", async () => {
    let fail = true;
    const { dictionary, calls } = harness(() =>
      fail ? new Response("busy", { status: 503 }) : upstream("犬"),
    );
    const first = await dictionary.lookup("犬");
    expect(first).toEqual({
      ok: false,
      error: { kind: "unavailable", detail: "jisho.org returned HTTP 503." },
    });
    fail = false;
    const second = await dictionary.lookup("犬");
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(2);
  });

  test("an unreadable body is unavailable, not a crash", async () => {
    const { dictionary } = harness(() => new Response("<html>", { status: 200 }));
    expect(await dictionary.lookup("犬")).toEqual({
      ok: false,
      error: {
        kind: "unavailable",
        detail: "jisho.org returned an unreadable payload.",
      },
    });
  });

  test("a slow upstream times out", async () => {
    const { dictionary } = harness(
      (input) =>
        new Promise<Response>((_, reject) => {
          // Mimic fetch honouring the abort signal by never resolving; the
          // service's own timer aborts and reports the timeout.
          void input;
          setTimeout(() => reject(new DOMException("aborted", "AbortError")), 60);
        }),
    );
    expect(await dictionary.lookup("犬")).toEqual({
      ok: false,
      error: { kind: "unavailable", detail: "jisho.org did not respond in time." },
    });
  });
});
