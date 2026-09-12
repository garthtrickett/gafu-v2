import type { Dictionary } from "./contracts.ts";
import { MAX_LOOKUP_TERM_LENGTH } from "./jisho.ts";

/**
 * `GET /api/dictionary/jisho?keyword=` — the one proxied search. It sits
 * behind private access like every other API route, so the proxy is not an
 * open relay to jisho.org. Returns null for any other request.
 */
export const handleDictionaryApi = async (
  request: Request,
  dictionary: Dictionary,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname !== "/api/dictionary/jisho") return null;
  if (request.method !== "GET") return new Response(null, { status: 405 });
  const keyword = url.searchParams.get("keyword") ?? "";
  // Four code units per allowed character is slack for ruby whitespace and
  // edge punctuation the server strips; anything longer is not a word.
  if (keyword.length === 0 || keyword.length > MAX_LOOKUP_TERM_LENGTH * 4) {
    return Response.json({ error: { kind: "invalidTerm" } }, { status: 400 });
  }
  const result = await dictionary.lookup(keyword, request.signal);
  if (result.ok) return Response.json(result.value);
  return Response.json(
    { error: { kind: result.error.kind } },
    { status: result.error.kind === "invalidTerm" ? 400 : 502 },
  );
};
