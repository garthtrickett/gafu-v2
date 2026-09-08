# Phase 0 data and AI topology

**Run:** 2026-09-08  
**Runtime:** Bun 1.3.2 on Linux x64

## Decisions

- Learner state is a local SQLite database whose sole writer is the owned Bun
  server ([ADR 0001](../adr/0001-local-bun-sqlite-is-the-first-release-writer.md)).
- The first backup is a quiescent, downloadable serialized SQLite snapshot;
  restore validates and reloads that snapshot as one database. API credentials
  are not included.
- The owned server serves the application and analyzer dictionary, owns data
  writes and backup/restore, holds the provider key, and translates
  provider-specific requests and errors.
- The provider key is pasted through the application, verified before use, and
  held only in local-server memory ([ADR 0002](../adr/0002-provider-keys-and-calls-stay-in-the-local-server.md)).
- Video and audio never leave the learner's machine. Series analysis may send
  normalized subtitle cue text plus local token/grammar annotations to the
  configured provider after an explicit analysis action. Known-bank subtraction
  remains local. Later card generation may send the target and the minimum
  known-language constraints needed to request `i`/`i+1` material.

## Data spike

The representative transaction creates one Plan, two canonical Cards, two plan
memberships, two source-evidence rows, and two schedules. A forced exception
after Card insertion rolls all five record groups back to zero. A successful
commit survives close/reopen from a temporary database file, and the serialized
backup restores all record counts in a new database instance.

Scores are 1 (poor fit) to 5 (strong fit). They are decision aids grounded in
the spike, not performance benchmarks.

| Criterion | Owned local Bun + SQLite | Browser IndexedDB |
|---|---:|---:|
| One authoritative writer / atomic plan commit | 5 | 3 |
| Durable against browser-data clearing | 5 | 2 |
| Backup, restore, migration, recovery | 5 | 2 |
| Local media/subtitle privacy | 5 | 5 |
| Low deployment/operation burden | 4 | 5 |
| Isolated deterministic tests | 5 | 4 |
| Later accounts/cross-device path | 4 | 2 |
| **Total** | **33** | **23** |

IndexedDB remains suitable for disposable browser UI state, but not for Card,
schedule, plan, or evidence authority. Reopen the decision if Gafu must become a
zero-install static site; that requirement would also need a deliberate sync,
backup, and multi-store consistency design.

## AI topology spike

The key-custody proof enters, verifies, replaces, and removes a key. A failed
replacement preserves the last verified key. OpenAI verification maps 401, 403,
429, other HTTP/transport failures, timeout, and cancellation to typed local
errors without including the key or response body. The Phase 0.5 Responses
adapter separately proves strict structured output, cancellation, timeout, and
the full provider error union.

| Criterion | Owned local proxy | Browser direct |
|---|---:|---:|
| Provider/browser policy independence | 5 | 2 |
| Key exposure and removal boundary | 5 | 1 |
| Paste-one-key normal setup | 4 | 4 |
| Cancellation and structured output | 5 | 4 |
| Error fidelity and redacted diagnostics | 5 | 3 |
| Low operation burden | 4 | 5 |
| Deterministic test substitution | 5 | 5 |
| **Total** | **33** | **24** |

Direct browser access was rejected because application JavaScript and browser
developer tools would share the long-lived credential boundary, and provider
CORS behavior would become a product dependency. Reopen key custody when a
cross-platform OS secret-store adapter is available and tested, or when Gafu
adds accounts and can hold per-user encrypted credentials in a remotely managed
server.

The OpenAI adapter follows the official [Responses create
contract](https://developers.openai.com/api/reference/resources/responses/methods/create/)
and uses the documented [response retrieval
contract](https://developers.openai.com/api/reference/resources/responses/methods/retrieve/)
only when a provider response ID is known.
