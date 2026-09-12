/// <reference lib="webworker" />
/**
 * Offline shell. Once the study page has loaded signed in, the page itself,
 * its hashed assets, the analyzer dictionary, and every spoken clip fetched
 * are kept, so a session already downloaded keeps working with no network.
 * API calls are never cached: the server stays authoritative, and the
 * browser's outbox carries writes across the gap.
 */
const worker = self as unknown as ServiceWorkerGlobalScope;

const SHELL = "gafu-shell-v1";
const ASSETS = "gafu-assets-v1";
const CLIPS = "gafu-clips-v1";
const DICTIONARY = "gafu-dictionary-v1";
const KEEP = new Set([SHELL, ASSETS, CLIPS, DICTIONARY]);

worker.addEventListener("install", () => {
  void worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (!KEEP.has(name)) await caches.delete(name);
      }
      await worker.clients.claim();
    })(),
  );
});

const cacheable = (response: Response): boolean =>
  response.ok && (response.type === "basic" || response.type === "default");

/** Immutable resources: serve what we have, fetch and keep what we lack. */
const cacheFirst = async (cacheName: string, request: Request): Promise<Response> => {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, { ignoreSearch: false });
  if (hit !== undefined) return hit;
  const response = await fetch(request);
  if (cacheable(response)) await cache.put(request, response.clone());
  return response;
};

/** The page: prefer the network so a deploy shows up; fall back when away. */
const shellFirst = async (request: Request): Promise<Response> => {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    // Only a signed-in page is worth keeping; the login page would trap the
    // learner offline. The server answers a signed-out shell request with a
    // redirect, which is not `ok`.
    if (cacheable(response) && !response.redirected)
      await cache.put("/", response.clone());
    return response;
  } catch {
    const hit = await cache.match("/");
    if (hit !== undefined) return hit;
    return new Response("Gafu is offline and no page is saved yet.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};

worker.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== worker.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(shellFirst(request));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(ASSETS, request));
    return;
  }
  if (/^\/api\/study\/presentations\/[^/]+\/audio$/u.test(url.pathname)) {
    event.respondWith(cacheFirst(CLIPS, request));
    return;
  }
  if (url.pathname.startsWith("/dict/")) {
    event.respondWith(cacheFirst(DICTIONARY, request));
  }
});
