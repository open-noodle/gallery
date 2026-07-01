# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gallery is a community fork of [Immich](https://github.com/immich-app/immich), a self-hosted photo and video management solution. The fork is currently based on **Immich v2.7.5** and regularly rebased onto upstream. Source package names are still `immich` / `immich-web` so the rebase path stays clean — only branding, Docker image names, and fork-only code diverge.

Fork-specific features layered on top of upstream include: shared spaces, smart search & filters, user groups, S3-compatible storage, auto-classification, video duplicate detection, pet detection, Google Photos import, image editing & video trimming, and structured JSON logging. See `README.md` for the full list and docs links.

It's a monorepo managed with **pnpm workspaces** containing:

- **server/** — NestJS 11 backend (TypeScript) — package name: `immich`
- **web/** — SvelteKit frontend with Svelte 5 (TypeScript) — package name: `immich-web`
- **mobile/** — Flutter/Dart app with Riverpod state management
- **machine-learning/** — Python FastAPI service (CLIP, facial recognition, OCR, YOLO pet detection via ONNX Runtime)
- **cli/** — Node.js CLI (`@immich/cli`)
- **open-api/** — OpenAPI spec and generated SDKs (`@immich/sdk`)
- **e2e/** — End-to-end tests (Playwright + Vitest)
- **docs/** — Docusaurus site deployed to `docs.opennoodle.de`
- **branding/** — Fork branding assets and the `apply-branding` script that rewrites upstream Immich references before Docker builds
- **deployment/** — Demo, personal, and marketing deploy configs and scripts

## Common Commands

### Development Environment

```bash
make dev                # Start full dev stack (Docker Compose)
make dev-update         # Rebuild and start dev stack
make e2e                # Run E2E test stack
```

### Building

```bash
make build-server       # Build server (NestJS)
make build-web          # Build web (SvelteKit) — depends on SDK
make build-sdk          # Build TypeScript SDK
make build-cli          # Build CLI — depends on SDK
```

### Testing

```bash
# Server
cd server
pnpm test                                    # Run all unit tests (vitest)
pnpm test -- --run src/services/album.service.spec.ts  # Run a single test file
pnpm test:cov                                # Unit tests with coverage
pnpm test:medium                             # Medium tests (require DB via Docker)

# Web
cd web
pnpm test                                    # Run all unit tests (vitest)
pnpm test -- --run src/lib/components/MyComponent.spec.ts  # Single test file

# E2E
cd e2e
pnpm test                                    # API tests (vitest)
pnpm test:web                                # Playwright web tests

# Run Playwright against an already-running `make dev` stack on :2283
make e2e-web-dev                             # web suite
make e2e-web-dev-ui                          # web suite with Playwright UI
make e2e-api-dev                             # API tests
make e2e-integration-dev                     # integration suite
```

### Linting & Formatting

```bash
# Per-module (from repo root)
make lint-server        # ESLint with --fix
make lint-web
make format-server      # Prettier --write
make format-web
make check-server       # TypeScript type check (tsc --noEmit)
make check-web          # svelte-check + tsc --noEmit

# All modules
make lint-all
make format-all
make check-all
```

### Code Generation

```bash
make open-api              # Regenerate all OpenAPI clients (Dart + TypeScript)
make open-api-typescript   # Regenerate TypeScript SDK only
make open-api-dart         # Regenerate Dart client only
make sql                   # Sync SQL query documentation from decorated repositories
```

### Database Migrations (server/)

```bash
pnpm migrations:generate   # Auto-generate migration from schema changes
pnpm migrations:run        # Apply pending migrations (fresh DB only, see note below)
pnpm migrations:revert     # Rollback last migration
pnpm schema:reset          # Drop and recreate schema (destructive)
```

**Fork migration layout:** Gallery maintains two migration directories in source:

- `server/src/schema/migrations/` — upstream Immich migrations (replaced during rebases)
- `server/src/schema/migrations-gallery/` — fork-only migrations (never touched by rebases)

**How they come together — the `postbuild` script:**

After `nest build` compiles TypeScript to `dist/`, the npm `postbuild` hook (`server/package.json`) copies `dist/schema/migrations-gallery/*.js` into `dist/schema/migrations/`. This means the built `dist/schema/migrations/` folder contains ALL migrations (upstream + fork) in one flat directory.

This merge is needed because:

1. **`sql-tools` CLI** (`migrations:run`, `generate`, `revert`) only reads from one folder (`dist/schema/migrations/`) and cannot be configured for multiple directories
2. **The server runtime** uses `CompositeMigrationProvider` which reads from both `dist/schema/migrations/` and `dist/schema/migrations-gallery/` — duplicates from the postbuild copy are silently handled via `Object.assign` (last folder wins, identical code)

**Why two source directories?** Keeping fork migrations in `migrations-gallery/` means upstream rebases never conflict with fork migration files. The `migrations/` directory gets replaced wholesale during rebases, while `migrations-gallery/` is untouched.

**Runtime migration behavior:** `DatabaseRepository.createMigrator()` uses `allowUnorderedMigrations: true` so fork migrations with timestamps interleaved between upstream ones apply correctly. This is critical for Immich-to-Gallery migration — users who switch from Immich already have upstream migrations applied, and the fork migrations slot in between them.

**`pnpm migrations:run`** uses `sql-tools` which hardcodes `allowUnorderedMigrations: false`. This works on fresh databases (CI, initial setup) but will fail on an existing database that already has upstream migrations applied. For existing databases, the server handles migrations automatically on startup via `DatabaseRepository.runMigrations()`.

**Adding new fork migrations:** Create new migration files in `server/src/schema/migrations-gallery/` with a timestamp that doesn't collide with existing migrations. Use round timestamps (e.g., `1775000000000`) for easy identification.

## Architecture

### Server (NestJS)

- **Workers**: Three worker types run as separate processes — API (HTTP), Microservices (background jobs), Maintenance
- **ORM**: Kysely (type-safe SQL query builder, NOT TypeORM). Schema defined in `server/src/schema/tables/`
- **Job Queue**: BullMQ with Redis for async tasks (thumbnails, encoding, ML, etc.)
- **Services**: All domain services extend `BaseService` (in `src/services/base.service.ts`) which provides access to ~40 injected repositories
- **Repositories**: Data access layer in `src/repositories/` with typed Kysely queries. Methods decorated with `@GenerateSqlQueries` get auto-documented
- **Controllers**: HTTP endpoints in `src/controllers/` with DTOs in `src/dtos/`
- **Middleware**: Auth guards, error interceptors, file upload handling in `src/middleware/`
- **Database**: PostgreSQL with extensions (pgvectors/vectorchord for embeddings, cube, earthdistance, pg_trgm)
- **Testing**: Vitest with `newTestService()` factory in `test/utils.ts` for auto-mocking dependencies. Medium tests use real DB via testcontainers
- **Fork-only services**: `shared-space.service.ts`, `classification.service.ts`, `pet-detection.service.ts`, and extensions to `duplicate.service.ts` (video dedup) live alongside upstream services. S3 support is wired through `storage.service.ts` / `storage.repository.ts` with both disk and S3 backends active simultaneously.

### Web (SvelteKit)

- **Svelte 5**: Uses `$state`, `$derived`, `$effect`, `$props` runes in newer code. Older code uses Svelte stores
- **Component library**: `@immich/ui` for shared UI primitives
- **State management patterns**:
  - **Managers** (`src/lib/managers/`): Class-based singletons using Svelte 5 runes for business logic
  - **Stores** (`src/lib/stores/`): Mix of Svelte writable stores and persisted stores
- **API client**: Generated `@immich/sdk` wrapping fetch calls
- **Real-time**: Socket.IO client for server events
- **Testing**: Vitest + @testing-library/svelte with happy-dom
- **Styling**: Tailwind CSS 4 with `@immich/ui` theme system

### Mobile (Flutter)

- **State management**: Riverpod (hooks_riverpod)
- **Local DB**: Isar with Drift for migrations
- **API client**: Generated from OpenAPI (in `mobile/openapi/`)
- **Navigation**: auto_route
- **Faces/people are local-first, and sync is owner-scoped.** The asset-viewer people strip (`people_details.widget.dart` → `driftPeopleAssetProvider` → `DriftPeopleRepository.getAssetPeople`) reads faces from the local Drift DB. The `person`/`asset_face` sync streams (`sync.repository.ts` `PersonSync`/`AssetFaceSync`) filter `ownerId = userId`, so a viewer never syncs faces for assets shared with them through a Space — unlike the web app, which fetches asset detail on demand (`AssetService.get`) and resolves those faces to the Space's people. For non-owned assets the mobile people strip therefore fetches from the asset-info endpoint (`PersonApiRepository.getAssetPeople`) to match web (issue #727); those server-resolved people are read-only on the strip, so the inline add-a-name / rename affordance is gated to owned assets. Tapping through to a shared person's own page still hits local Drift and remains limited.
- **Running mobile unit tests locally** (mirrors `.github/workflows/test.yml`): use Flutter **3.41.7** (the pinned SDK; `mise.toml` may symlink an older patch). From `mobile/`: `flutter pub get`, then generate localization/keys once — `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart` (the `lib/generated/*.g.dart` files are gitignored) — then `flutter test <path>`. Drift/OpenAPI generated code is committed, so `build_runner` is not needed for tests.

### Machine Learning (Python)

- **Framework**: FastAPI with Gunicorn/Uvicorn
- **Models**: ONNX Runtime inference (CLIP, InsightFace, RapidOCR)
- **Model management**: Hugging Face Hub with local caching
- **Package manager**: uv

## Code Style

- **Formatting**: Prettier with 120 char line width, single quotes, trailing commas, semicolons
- **Imports**: Auto-organized by `prettier-plugin-organize-imports`
- **Linting**: ESLint with zero warnings policy (`--max-warnings 0`)
- **Server imports**: No relative imports allowed — use `src/` path alias
- **TypeScript**: Strict mode in all packages
- **Async**: `no-floating-promises` and `no-misused-promises` enforced everywhere

## OpenAPI Workflow

When server API endpoints change:

1. Build server: `cd server && pnpm build`
2. Regenerate specs: `pnpm sync:open-api`
3. Regenerate clients: `make open-api` (generates both TypeScript SDK and Dart client)

The TypeScript SDK uses `oazapfts` for generation. The Dart client uses OpenAPI Generator with custom mustache templates and patches (Java required — see `feedback_openapi_dart_generation`).

## Fork Branding

Upstream Immich references are rewritten to Gallery at build time by `branding/apply-branding.sh`. This runs automatically inside the Dockerfiles before `nest build` / the web build, so local `pnpm dev` and `make dev` keep upstream names in source. **Do not commit branded output**: edit the original Immich references and let the script rewrite them during Docker builds. Skipping `apply-branding` before a Docker build will leak upstream names into deployed artifacts.

## Releases & Deploys

- **Release workflows** (manual `workflow_dispatch`, triggered from `main`): mobile and server release **independently** — no draft handoff, no auto-versioning (versions are always supplied manually).
  - **Release Mobile** (`.github/workflows/gallery-release-mobile.yml`): takes a required `version`, builds + signs the Android AAB/APK and iOS IPA, uploads the AAB to Play internal and the IPA to TestFlight, keeps the APK as a workflow artifact, and records the built commit SHA in the run summary. Creates no GitHub Release or git tag.
  - **Release Gallery Server** (`.github/workflows/gallery-release-server-only.yml`): takes a required `version` and an optional `commit` (defaults to branch HEAD; pass the SHA the mobile run recorded to ship a matching build). Builds + pushes `gallery-server` / `gallery-ml` / `gallery-ml:*-cuda`, moves the `vX.Y.Z` / `vX` / `release` tags, creates the GitHub Release, and flips the version endpoint self-hosted instances poll. See `docs/plans/2026-05-18-decoupled-release-design.md`.
- **Deploy targets**: `demo.opennoodle.de` (demo), `docs.opennoodle.de` (Docusaurus). Each has a corresponding skill in `.claude/skills/` (see `/deploy-gallery-*` slash commands).
- **RC builds**: `rc-personal` skill ships a tagged server image to the personal instance via a compose override — remember to remove the override after merge or release deploys will ship stale RC images.

## Contributing & Docs

- `CONTRIBUTING.md` and the README's Contributing section cover the dev-environment setup (`cp docker/example.env docker/.env`, `pnpm install`, `make dev`).
- User-facing docs live in `docs/docs/` and are deployed to `docs.opennoodle.de`. Run prettier on any markdown under `docs/` or `docs/plans/` before committing — CI Docs Build is strict.
- Guides for switching to / from Gallery live under `docs/docs/guides/` — the switch-back-to-immich script is at `scripts/revert-to-immich/`.
- The README's "What's Different from Upstream Immich" section must stay in feature parity with the marketing site (source of truth: `apps/marketing/src/data/features.ts` + `apps/marketing/src/pages/features/*.astro` in the `platform` repo) and mirror the grouping of the `noodle-gallery-vs-immich` comparison post. When a feature launches there (see the `launch-new-feature` skill), update this README too. Each feature links to `https://opennoodle.de/features/<marketing-slug>` and, where one exists, `https://docs.opennoodle.de/features/<docs-slug>` — note docs slugs can differ from marketing slugs (e.g. `dynamic-filters`→`dynamic-filter-suggestions`, `image-editing`/`video-trimming`→`editing`, `connected-libraries`→`libraries`, memories→`memories`, mobile apps→`mobile-app`).
