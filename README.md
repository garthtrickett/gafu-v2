# Gafu V2

Gafu V2 is a fresh implementation of Gafu: an AI-generated Japanese SRS that
prepares a learner for media they want to understand.

This repository contains the product foundation, the Phase 1 local Card bank,
and the retained Phase 0 diagnostic harness:

- [`V2.md`](V2.md) — product requirements and resolved product decisions;
- [`CONTEXT.md`](CONTEXT.md) — canonical domain language; and
- [`v2-impl.md`](v2-impl.md) — phased implementation plan and exit gates.

The active phase is documented in
[`phases/phase-1.md`](phases/phase-1.md).

The current application remains in
[`garthtrickett/gafu`](https://github.com/garthtrickett/gafu) while V2 is built.
V1 code is reference material, not the starting architecture for this repo.

## Development

```bash
bun install
bun run check
bun test
bun run build
bun run test:browser
```

Run the local Study server and Vite client with `bun run dev`, then open
`http://127.0.0.1:4173`. Learner data is stored in `data/gafu-v2.sqlite` and can
be backed up from the browser. The Phase 0 diagnostic remains available from
the link in the app.

Build the browser and serve the production-style local app with:

```bash
bun run build
bun run start
```
