---
status: accepted
---

# A local Bun server and SQLite are the first-release writer

Gafu V2 will keep learner state in one SQLite database owned by a local Bun
server. This gives Study one authoritative transactional writer, durable data
outside browser eviction, and whole-database backup/restore; browser IndexedDB
was rejected as the source of truth because coordinated multi-record plan
commits, recovery, and user-verifiable backups would be weaker. The browser
remains the UI and local media surface, while accounts and cross-device sync are
deferred rather than simulated with a second store.
