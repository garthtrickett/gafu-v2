import { describe, expect, test } from "bun:test";
import {
  authorizeLocalMutation,
  LOCAL_MUTATION_HEADER,
  LOCAL_MUTATION_VALUE,
  readBoundedBody,
  readBoundedJson,
} from "./local-api.ts";

describe("local API boundary", () => {
  test("requires the non-simple Gafu header for every mutation", () => {
    const hostile = new Request("http://127.0.0.1/api/study/session", {
      method: "POST",
      headers: { Origin: "https://hostile.example" },
    });
    expect(authorizeLocalMutation(hostile)).toEqual({
      ok: false,
      error: "forbidden",
    });
    const trusted = new Request(hostile, {
      headers: { [LOCAL_MUTATION_HEADER]: LOCAL_MUTATION_VALUE },
    });
    expect(authorizeLocalMutation(trusted)).toEqual({ ok: true, value: undefined });
    expect(authorizeLocalMutation(new Request("http://127.0.0.1/api/study"))).toEqual({
      ok: true,
      value: undefined,
    });
  });

  test("rejects wrong content types and streaming bodies over the limit", async () => {
    expect(
      await readBoundedJson(
        new Request("http://localhost", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        }),
      ),
    ).toEqual({ ok: false, error: { kind: "contentTypeInvalid" } });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    });
    expect(await readBoundedBody(new Response(stream), 8)).toEqual({
      ok: false,
      error: { kind: "bodyTooLarge", maximumBytes: 8 },
    });
  });
});
