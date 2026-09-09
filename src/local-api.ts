import { err, ok, type Result } from "./result.ts";

export const LOCAL_MUTATION_HEADER = "X-Gafu-Request";
export const LOCAL_MUTATION_VALUE = "gafu-v2";
export const MAXIMUM_JSON_BODY_BYTES = 256 * 1024;

export type BoundedBodyFailure =
  | { readonly kind: "bodyTooLarge"; readonly maximumBytes: number }
  | { readonly kind: "bodyUnreadable" };

export type JsonBodyFailure =
  | BoundedBodyFailure
  | { readonly kind: "contentTypeInvalid" }
  | { readonly kind: "jsonInvalid" };

export const mutationHeaders = (headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set(LOCAL_MUTATION_HEADER, LOCAL_MUTATION_VALUE);
  return result;
};

export const authorizeLocalMutation = (request: Request): Result<void, "forbidden"> =>
  request.method === "GET" ||
  request.method === "HEAD" ||
  request.headers.get(LOCAL_MUTATION_HEADER) === LOCAL_MUTATION_VALUE
    ? ok(undefined)
    : err("forbidden");

export const readBoundedBody = async (
  request: Request | Response,
  maximumBytes: number,
): Promise<Result<Uint8Array, BoundedBodyFailure>> => {
  const declaredHeader = request.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0) {
      return err({ kind: "bodyUnreadable" });
    }
    if (declared > maximumBytes) {
      return err({ kind: "bodyTooLarge", maximumBytes });
    }
  }
  if (request.body === null) return ok(new Uint8Array());
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel();
        return err({ kind: "bodyTooLarge", maximumBytes });
      }
      chunks.push(chunk.value);
    }
  } catch {
    return err({ kind: "bodyUnreadable" });
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(bytes);
};

export const readBoundedJson = async (
  request: Request,
  maximumBytes = MAXIMUM_JSON_BODY_BYTES,
): Promise<Result<unknown, JsonBodyFailure>> => {
  const contentType = request.headers.get("content-type")?.toLocaleLowerCase();
  if (contentType?.startsWith("application/json") !== true) {
    return err({ kind: "contentTypeInvalid" });
  }
  const body = await readBoundedBody(request, maximumBytes);
  if (!body.ok) return body;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.value);
    return ok(JSON.parse(text));
  } catch {
    return err({ kind: "jsonInvalid" });
  }
};

export const decodePathSegment = (value: string): Result<string, "invalidEncoding"> => {
  try {
    return ok(decodeURIComponent(value));
  } catch {
    return err("invalidEncoding");
  }
};
