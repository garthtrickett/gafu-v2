---
status: accepted
---

# Provider keys and calls stay in the local server

The browser will send key-management intents and AI requests to the local Bun
server; it will never hold or call a provider with the key. A pasted key is
verified before replacing the current value and is held only in server memory
for the first release, so it is excluded from backups and must be re-entered
after a server restart. This trades restart convenience for a small, explicit
credential boundary now; durable OS-backed secret storage may replace memory
later without moving provider-specific errors or payloads into the browser.
