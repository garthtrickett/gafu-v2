# Repository replacement checklist

This checklist is a release operation, not an automated Phase 6 side effect.
The codebase does not have authority to archive repositories or declare the
owner's private migration accepted.

## Before changing repository status

- Complete and record every owner gate in [`cutover.md`](cutover.md).
- Resolve `LICENSE-DECISION.md`; do not copy legacy source while its reuse terms
  remain unresolved.
- Keep final V1 and `jp-player` commit SHAs in the replacement release note.
- Confirm the V2 backup/restore rehearsal includes Study, Preparation, plans,
  migration audit, and Watch capture evidence.
- Confirm V1 is no longer receiving reviews and no required V1-only data was
  omitted from the accepted reconciliation.
- Confirm V2's documented native-codec/strict-SRT Watch envelope is acceptable;
  V2 does not silently claim all historical `jp-player` playback features.

## V1 maintenance-only notice

When the owner approves cutover, update V1's README and repository description
to state:

> Gafu V1 is maintenance-only and retained for rollback/history. New learning
> happens in Gafu V2. Do not create independent progress in both applications.

Link to the V2 repository and its cutover report. Do not delete V1 data,
branches, releases, issues, or tags.

## `jp-player` archival

Archive only after the V2 Watch journey and accepted codec boundary have been
verified on the owner's actual media. Before archiving:

- add a README notice pointing to V2 Watch;
- record which player behaviors were retained and which remain intentionally
  unsupported;
- preserve issues and the final source commit; and
- use the hosting service's reversible archive action rather than deleting the
  repository.

## Current status

- Phase 6 implementation evidence: complete in PR #16, including authoritative CI.
- Real private-data reconciliation: not recorded.
- Multi-day owner acceptance journey: not recorded.
- Licence/external data gates: pending.
- V1 maintenance-only change: not authorized yet.
- `jp-player` archive: not authorized yet.
