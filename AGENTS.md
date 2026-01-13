# Repository Guidelines

## Project Structure & Module Organization
- `src/`: Application code (services, DB schema, and libs).
- `scripts/`: One-off utilities and seed scripts (e.g., `scripts/seed-masjids.ts`).
- `drizzle/`: Database migrations output.
- Root config: `drizzle.config.ts`, `sst.config.ts`, `tsconfig.json`, `package.json`.
- Reference docs: `DATABASE_SCHEMA.md` and `DYNAMODB_SCHEMA.md`.

## Build, Test, and Development Commands
- `pnpm dev`: Run SST in local dev mode.
- `pnpm deploy` / `pnpm deploy:prod`: Deploy to dev or production.
- `pnpm db:generate`: Generate Drizzle migrations.
- `pnpm db:push`: Apply migrations to the database.
- `pnpm seed`: Seed DynamoDB masjid data.
- `pnpm seed:achievements`: Seed Postgres achievement definitions.
- `pnpm update:checkin-radius`: Update DynamoDB check-in radius from CSV.

## Coding Style & Naming Conventions
- Language: TypeScript, ESM (`"type": "module"`).
- Indentation: 2 spaces, double quotes for strings, semicolons.
- Naming: `camelCase` for variables/functions, `PascalCase` for types/interfaces, `kebab-case` for script names.
- No repo-level lint/format tooling configured; keep style consistent with existing files in `src/` and `scripts/`.

## Testing Guidelines
- No test framework or scripts are currently defined.
- If adding tests, document the runner and add a `pnpm test` script in `package.json`.

## Commit & Pull Request Guidelines
- No formal commit convention is documented; use concise, present-tense messages (e.g., `Add achievement seed`).
- PRs should include a clear summary, rationale, and any migration/seed steps needed to verify.

## Security & Configuration Tips
- Postgres tools and seeds require `DATABASE_URL`.
- DynamoDB scripts require AWS credentials and may rely on `AWS_PROFILE`, `AWS_REGION`, and `CSV_PATH`.
- Avoid committing secrets; prefer environment variables or SST resources.
