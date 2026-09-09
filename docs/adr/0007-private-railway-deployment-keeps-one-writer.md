---
status: accepted
---

# A private Railway deployment keeps one learner and one SQLite writer

The owner wants the deployed Gafu V2 instance, rather than a laptop, to become
the authoritative product. The first-release domain model still has one learner
and one transactional SQLite writer. Replacing that model with multi-user
Postgres solely to put the process on Railway would enlarge every Study,
Preparation, migration, and recovery seam before there is a multi-user product
requirement.

Gafu V2 will therefore run as one Railway service with exactly one replica and
one attached persistent volume. Its SQLite database and private Kaishi manifest
must both live inside that volume. Public deployment is an explicit mode that
binds to Railway's `PORT` on all interfaces and refuses to start when the data
paths are not inside the attached volume.

A server-owned private-access module gates the complete application with one
deployment password. It issues random, opaque, Secure, HttpOnly, SameSite=Strict
session cookies, stores only token digests in process memory, expires sessions,
and throttles failed login attempts. The existing non-simple mutation header
remains an independent cross-site request defense. `/healthz` is the only
unauthenticated operational route and returns no learner data.

This is a private single-user deployment, not a hosted account system. A process
restart ends active sessions. The password and optional OpenAI key are Railway
secrets and never enter SQLite backups. SQLite prevents horizontal replicas and
requires the process to be stopped before volume-file replacement. A parallel
V2 service and rehearsal domain must pass the real-data cutover before the V1
service or its public domain changes.
