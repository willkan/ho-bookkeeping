# `@bookkeeping/contracts`

Versioned Zod schemas for AI parse requests and untrusted proposal responses.

## Boundary

This package contains **only** AI parse DTOs used by the mobile client:

- `ParseRequest` / `ParseResponse` (proposal or typed error)
- flat candidate consumption records
- tag candidates and mode snapshot for a single parse

It is **not** a client↔gateway deployment contract (phase-1 has no AI gateway).  
Provider JSON is parsed on device and validated here before the application state machine may post.

It must **not** export SQLite entities, domain repositories, UI view models, posting state machines, or API keys.

Money on the wire is always integer minor units.
