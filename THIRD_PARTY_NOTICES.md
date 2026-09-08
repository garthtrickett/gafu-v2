# Third-party notices

Phase 0 evaluates the following Japanese analyzers. Their inclusion is not a
permanent architecture commitment.

## @faanau/kuromoji 0.2.1

- Purpose: maintained Kuromoji/IPADIC candidate and selected Phase 0 analyzer.
- License: Apache License 2.0.
- Provenance: maintained fork of Takuya Asano's `kuromoji.js`, originally a port
  of Atilika Kuromoji.
- Distribution: the Vite spike packages the dependency directory so its
  `LICENSE-2.0.txt` and `NOTICE.md` ship beside the dictionary.

## @libraz/suzume 0.9.10

- Purpose: independent browser/WASM comparison candidate.
- License: Apache License 2.0.
- Distribution: evaluation dependency only; not loaded by the selected browser
  adapter.

The package lock is the authoritative version record. Upstream copyright and
notice text remains in each installed package and, for the selected analyzer,
in the built distribution.
