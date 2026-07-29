# Mobile app

Expo / React Native application. Route files belong in `app/`; stable implementation code belongs under `src/` according to the root `AGENTS.md` architecture boundaries.

```text
app/                          Expo Router route assembly
src/domain/                   pure business types and rules
src/application/              use cases and state transitions
src/infrastructure/db/        SQLite schema, migrations, repositories
src/infrastructure/ai/        AI transport adapter
src/infrastructure/jobs/      durable queue runner
src/infrastructure/export/    Excel projections and files
src/ui/                       design tokens, primitives, features
```
