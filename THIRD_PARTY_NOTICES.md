# Third-party notices

Gafu V2 includes the following Japanese analyzer.

## @faanau/kuromoji 0.2.1

- Purpose: maintained Kuromoji/IPADIC implementation selected in Phase 0.
- License: Apache License 2.0.
- Provenance: maintained fork of Takuya Asano's `kuromoji.js`, originally a port
  of Atilika Kuromoji.
- Distribution: the Vite spike packages the dependency directory so its
  `LICENSE-2.0.txt` and `NOTICE.md` ship beside the dictionary.

The package lock is the authoritative version record. Upstream copyright and
notice text remains in the installed package and built distribution.

## doublearray 0.0.2

- Purpose: runtime trie dependency of the selected analyzer.
- License: MIT.
- Distribution: installed through `@faanau/kuromoji`; its `LICENSE.txt` remains
  in the dependency tree.

## lit-html 3.3.3

- Purpose: render the browser application and diagnostic route.
- License: BSD 3-Clause.
- Distribution: bundled into the application JavaScript; upstream `LICENSE`
  remains in the installed package.

## ts-fsrs 5.4.2

- Purpose: deterministic FSRS 6 scheduling behind the Study module.
- License: MIT.
- Distribution: used by the local Bun server; upstream `LICENSE` remains in the
  installed package.
