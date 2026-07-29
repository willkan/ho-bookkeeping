# Bookkeeping repository instructions

## 1. Formal truth and priority

Before changing code, read these files in order:

1. `docs/PRD.md` — product behavior and business truth.
2. `docs/TECHNICAL-SELECTION.md` — architecture and technology boundaries.
3. `docs/designs/final-v1/README.md` and its four PNG boards — current visual direction.
4. `docs/designs/full-screen-inventory.md` —一期 required screens, states, and dialogs.

When documents disagree, do not silently choose one. Classify the drift and update the narrowest formal truth before implementation. Historical designs under `docs/designs/complete-v3` and `concept-*` are not contracts.

## 2. Product invariants

- iOS and Android share one product contract.
- Phase 1 is single-device, single-person, single-ledger. Do not add accounts, sync, family sharing, cloud backup, or restore.
- Local SQLite is the only official ledger fact source.
- AI output is an untrusted proposal. Only local schema validation and the application state machine may post records.
- One raw input may create zero, one, or many peer consumption records. A consumption record represents exactly one purchase. Never create shopping groups, child consumption items, or persisted aggregate records.
- Saving a raw input and its unique pending parse job is one SQLite transaction.
- A multi-record AI result validates and posts as one list. Never silently post a valid subset.
- Statistics are projections over current effective flat consumption records. They must not double count and must include an explicit unclassified bucket for an exclusive breakdown group.
- Business deletion is soft deletion. Official queries must exclude `deleted_at IS NOT NULL` unless explicitly inspecting deleted data.
- Money is integer minor units. Never store or calculate money with floating point.
- Preserve the original input. Manual structured edits override AI without rewriting the original text.
- The full ledger never goes to the AI provider. Send only the minimum data required for one parse request.
- Phase-1 AI is personal BYOK: one user-configured OpenAI-compatible Chat Completions endpoint. API key only in expo-secure-store; never SQLite, logs, export, or repo.

## 3. Architecture boundaries

```text
UI → application use cases/state machine → domain + repository ports
                                      ↘ infrastructure adapters
SQLite = fact source
AI response / statistics / export / UI state = proposal or projection
```

- `app/` contains Expo Router route assembly only. No SQL, AI calls, or business rules.
- `src/domain/` contains pure business types and rules. It imports neither React nor Expo.
- `src/application/` owns use-case orchestration and visible state transitions.
- `src/infrastructure/db/` owns schema, forward migrations, parameterized SQL, and repository implementations.
- `src/infrastructure/jobs/` owns durable queue execution, not job truth; job truth remains in SQLite.
- `src/infrastructure/ai/` implements BYOK secure config and the OpenAI-compatible transport port only.
- `src/infrastructure/export/` builds export projections and local files.
- `src/ui/` contains design tokens, primitives, and feature components.
- `packages/contracts` contains only versioned AI parse request/proposal schemas for local validation. Do not expose SQLite entities or UI models there.
- There is no phase-1 AI gateway service workspace; do not reintroduce a dual production path.

Do not introduce Redux, a remote database, an ORM, CRDT, event sourcing, a workflow engine, multiple AI-provider fallbacks, or speculative sync infrastructure in phase 1.

## 4. Required development flow

Classify every request before writing code:

- New capability or business flow: follow the PRD flow below.
- Cleanup, convergence, test layering, legacy removal, or architecture correction: first audit old paths and state the net entropy change. Do not preserve obsolete paths as fallback.
- A single implementation defect under an already sufficient contract: make the smallest sufficient correction.

For new capabilities:

1. Narrow or confirm the requirement in the appropriate formal document.
2. Add named positive and negative test-case skeletons without test logic.
3. Map each case through the formal contract and identify gaps.
4. Update transport/domain/database contracts before implementation.
5. Implement one tracer-bullet vertical slice at a time.
6. Run tests, typecheck, lint, and relevant iOS/Android verification; fix until green.

Never change a contract merely to make an existing implementation or fake pass. Fakes replace only external transport; do not fake the application service, state machine, or SQLite repository in integration tests.

## 5. Mobile engineering rules

- Use Expo, React Native, TypeScript, Expo Router, and `expo-sqlite` as selected.
- Use Expo development builds; SQLCipher is not an Expo Go target.
- Native-code dependencies must be direct dependencies of `apps/mobile` for autolinking.
- Keep one exact version of each dependency across the workspace. Do not use `^` or `~` for app dependencies.
- Use Expo Router native stack/native tabs. Do not import alternate JavaScript navigators.
- Use `StyleSheet.create` and centralized tokens. Do not introduce a general-purpose UI kit or NativeWind.
- Use `Pressable`, native modals where suitable, safe-area-aware layouts, and platform accessibility labels.
- Use FlashList for ledger, drill-down, and other unbounded lists; memoize row components and keep expensive work outside rows.
- Animate only transform and opacity unless a measured need proves otherwise. Respect reduced-motion settings.
- Derive values instead of duplicating them in React state. SQLite/domain facts must not be copied into a second global source of truth.
- UI must match the calm, celadon-white, ink-green visual direction in `docs/designs/final-v1`; do not turn every section into a card.

## 6. Database and job rules

- Enable foreign keys and WAL at database initialization.
- Use explicit, forward-only SQL migrations and constraints. Never mutate an old released migration.
- All SQL with values is parameterized.
- Every official record has a stable client-generated ID plus `created_at`, `updated_at`, and nullable `deleted_at` where applicable.
- Store an instant plus the timezone/local-date information required to reproduce user-facing time semantics.
- Queue claims and state changes are transactional. Jobs have explicit attempts, next eligible time, terminal/retryable failure category, and idempotency identity.
- OS background scheduling is only a trigger. The SQLite job row is the formal task state.
- App foreground/startup always resumes eligible jobs. A user force-quit may delay work until next launch.
- No infinite retry, swallowed error, implicit default result, or partial posting.

## 7. AI BYOK and privacy

- Use the official OpenAI JS/TS SDK as a direct `apps/mobile` dependency (exact version), configured with user `baseURL` / `apiKey` / model. Do not write raw HTTP when the SDK covers the call.
- Call OpenAI-compatible **Chat Completions JSON mode** (`response_format: json_object`). Do not rely on Responses-only helpers that compatible providers may lack.
- Store the user API key only in `expo-secure-store`. Never put keys in the mobile bundle, repository, SQLite, export, logs, or error text. Endpoint and model may share the same secure config record.
- Any required client-environment SDK opt-in (e.g. `dangerouslyAllowBrowser`) must be narrowly isolated in the infrastructure adapter and documented.
- Requests include `contract_version` and a stable client request ID. Validate provider JSON against local transport/domain schemas; never accept partial results or synthesize fallback output.
- Log only request ID, contract/model, provider host, config revision, latency, token usage, status, and error category — never raw input, amounts, merchants, tags, full model output, or the API key.
- No provider registry, provider fallback, automatic model fallback, or gateway fallback. Config changes apply to eligible pending/future jobs only; effective records never change.

## 8. Tests and gates

Default local gates:

- formatting/lint
- TypeScript typecheck
- domain and state-machine unit tests
- SQLite real-database migration/repository/statistics integration tests
- contract tests for AI parse request/proposal schemas

Add E2E only for user-critical flows after the first vertical slice. Use exactly one E2E framework after its spike; remove the rejected path.

Critical cases include:

- raw input and parse job are saved atomically
- app restart resumes the pending job
- late/out-of-order AI responses cannot attach to another input
- one input producing three purchases creates three independent records
- one invalid candidate prevents automatic partial posting
- manual edits do not modify sibling records or original text
- coupon purchase and use do not double count
- exclusive breakdown totals equal the filtered record total, including unclassified
- OR tag filters deduplicate records; AND filters require all selected tags
- soft-deleted records are absent from ledger, statistics, and normal export

## 9. Change hygiene

- Use `rg`/`rg --files` for discovery.
- Use focused modules; a file over 800 lines is a design warning.
- Do not retain legacy paths, compatibility aliases, unused adapters, or fallback branches after replacement.
- Do not add empty future service layers. A new abstraction must replace duplicated or misplaced complexity now.
- Preserve unrelated user changes.
- Do not commit secrets, `.env*`, `.dev.vars*`, generated credentials, or raw personal ledger fixtures.
- If committing, use global Git author configuration only. Never set repository-local author fields or add AI co-author trailers.

## 10. Definition of done

A feature is not done because a screen renders. It is done when its formal contract is current, positive and negative cases pass, SQLite/state-machine behavior is verified, the UI covers loading/empty/error/recovery states, and the relevant behavior works on both iOS and Android or has an explicitly documented platform blocker.

