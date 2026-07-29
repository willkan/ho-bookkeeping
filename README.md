# 清简账本 (bookkeeping)

Phase-1 local diary-style bookkeeping for iPhone and Android.

Formal truth (read in order):

1. `docs/PRD.md`
2. `docs/TECHNICAL-SELECTION.md`
3. `docs/designs/final-v1/README.md` (+ four PNG boards)
4. `docs/designs/full-screen-inventory.md`
5. `AGENTS.md`

## Workspace layout

```text
apps/mobile              Expo Router app (SDK 57, SQLCipher, domain / application / infrastructure / ui)
packages/contracts       Zod AI parse request / proposal schemas (local validation only)
```

Phase-1 AI path is **personal BYOK**: configure Endpoint, API Key, and Model inside the app. There is no Cloudflare AI gateway workspace and no `.env` provider key.

## Install (npm workspaces)

```bash
npm install
```

## Gates

```bash
npm test
npm run typecheck
npm run lint          # real ESLint (not typecheck alias)
npm run format:check
npm run doctor        # expo-doctor
npm run export:ios
npm run export:android
```

## Mobile

```bash
# development build required (SQLCipher is not Expo Go)
npm start -w @bookkeeping/mobile
```

**AI parse (BYOK):** open **设置 → AI 提供商**. New devices prefill Endpoint `https://api.deepseek.com` and Model `deepseek-v4-flash`; enter your API Key (or edit all fields for another OpenAI-compatible provider), then Save. No `EXPO_PUBLIC_*` gateway URL or repo-side key is required.

Missing or cleared provider config is an **explicit visible configuration failure**. Jobs are retained; Fake/demo transports are not available at runtime. Tests inject `FakeAiParseTransport` only.

SQLCipher:

- `expo-sqlite` plugin `useSQLCipher: true`
- Key material from **`expo-crypto` `getRandomBytes` only** (no non-crypto PRNG; failure is explicit)
- Key stored with `expo-secure-store`; `PRAGMA key` before any schema read
- Client IDs via **`IdGenerator` port** + production `ExpoCryptoIdGenerator` (`randomUUID`); tests inject `SequenceIdGenerator`
- Native boundary: crypto + secure store + SQLCipher require a development/production build

Provider API key (separate from SQLCipher key):

- Entered by the user; stored **only** in `expo-secure-store`
- Never written to SQLite, export files, logs, or the repository
- Rooted/jailbroken devices can still expose local secrets — the settings UI discloses this briefly

Background parse (supplemental):

- `expo-background-task` + `expo-task-manager` register one OS task that resumes the same `ParseJobRunner` / encrypted SQLite jobs
- Startup and AppState foreground always resume eligible jobs; OS timing is **not guaranteed**
- Foreground and background both resolve the same secure BYOK config; missing config fails jobs explicitly (no demo transport)

## Unverified native gaps

- SQLCipher encryption at runtime requires a **development/production build** (not Expo Go); not exercised in this Node CI path beyond config/contract tests and `better-sqlite3` schema tests.
- `expo-crypto` key generation + Secure Store keychain behavior need a physical/simulator build.
- Live provider Chat Completions call is not smoke-tested without the user entering their own key in the app.
- **OS background task fire timing** (`expo-background-task` / TaskManager) is not guaranteed by the OS and is not CI-verified on device; registration + startup/AppState resume are implemented.
