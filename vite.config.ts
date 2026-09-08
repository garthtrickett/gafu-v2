import { readFile } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const dictionaryDirectory = fileURLToPath(
  new URL("./node_modules/@faanau/kuromoji/dict", import.meta.url),
);
const dictionaryFiles = new Set([
  "base.dat.gz",
  "cc.dat.gz",
  "check.dat.gz",
  "tid.dat.gz",
  "tid_map.dat.gz",
  "tid_pos.dat.gz",
  "unk.dat.gz",
  "unk_char.dat.gz",
  "unk_compat.dat.gz",
  "unk_invoke.dat.gz",
  "unk_map.dat.gz",
  "unk_pos.dat.gz",
]);

const rawDictionaryTransport = (): Plugin => ({
  name: "gafu-raw-kuromoji-dictionary",
  configureServer: (server) => {
    server.middlewares.use("/dict", (request, response, next) => {
      const filename = request.url?.split("?", 1)[0]?.replace(/^\//, "");
      if (filename === undefined || !dictionaryFiles.has(filename)) {
        next();
        return;
      }
      readFile(resolve(dictionaryDirectory, filename), (error, contents) => {
        if (error !== null) {
          next(error);
          return;
        }
        // The browser loader owns gzip decompression. Content-Encoding would
        // make the browser decode first and cause a second, failing decode.
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", contents.byteLength);
        response.end(contents);
      });
    });
  },
});

export default defineConfig({
  // The spike serves and packages Kuromoji's dictionary together with its
  // Apache licence and NOTICE. Phase 0.6 decides its final runtime location.
  publicDir: "node_modules/@faanau/kuromoji",
  plugins: [rawDictionaryTransport()],
  resolve: {
    alias: {
      "@faanau/kuromoji": fileURLToPath(
        new URL("./node_modules/@faanau/kuromoji/src/kuromoji.js", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
});
