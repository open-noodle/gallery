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

After `nest build` compiles TypeScript to `dist/`, the npm `postbuild` hook (`server/package.json`) runs `server/bin/sync-gallery-migrations.mjs`, which does three things:

1. **Copies** `dist/schema/migrations-gallery/*.js` into `dist/schema/migrations/`. This means the built `dist/schema/migrations/` folder contains ALL migrations (upstream + fork) in one flat directory.
2. **Removes stale copies**: if a fork migration file in `migrations-gallery/` was renamed, it deletes the old copy left behind in `dist/schema/migrations/` from a previous build.
3. **Writes a build-time compatibility alias**: a `compatibilityAliases` array copies the current `1777667825574-ChangeDurationToInteger.js` to a second copy named `1776735180298-ChangeDurationToInteger.js` (`from` → `to`). `ChangeDurationToInteger` was re-timestamped upstream from `1776735180298` to `1777667825574`, and the fork's source now carries only the current `1777667825574` file. Already-deployed v5-RC/staging databases, however, ran the migration under its **pre-rename** `1776735180298` name and recorded _that_ — and Kysely hard-fails on boot if a migration name recorded in the DB has no matching file on disk. The alias makes `dist/schema/migrations/` contain the compiled file under **both** names, so already-deployed DBs (recorded `1776735180298`) and fresh installs (run `1777667825574`) both boot cleanly. **This alias is load-bearing — do not remove it** without a migration path for already-deployed DBs that recorded the pre-rename name.

The copy step (1) is needed because:

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
- **API client**: Generated from OpenAPI at build time (in `mobile/generated/openapi/`, gitignored)
- **Navigation**: auto_route
- **Faces/people are local-first, and sync is owner-scoped.** The asset-viewer people strip (`people_details.widget.dart` → `driftPeopleAssetProvider` → `DriftPeopleRepository.getAssetPeople`) reads faces from the local Drift DB. The `person`/`asset_face` sync streams (`sync.repository.ts` `PersonSync`/`AssetFaceSync`) filter `ownerId = userId`, so a viewer never syncs faces for assets shared with them through a Space — unlike the web app, which fetches asset detail on demand (`AssetService.get`) and resolves those faces to the Space's people. For non-owned assets the mobile people strip therefore fetches from the asset-info endpoint (`PersonApiRepository.getAssetPeople`) to match web (issue #727); those server-resolved people are read-only on the strip, so the inline add-a-name / rename affordance is gated to owned assets. Tapping through to a shared person's own page still hits local Drift and remains limited.
- **One unified `Person` model (upstream #30659/#30660/#30662, reconciled 2026-08-13).** `PersonDto` and `DriftPerson` were collapsed into a single `Person` in `mobile/lib/domain/models/person.model.dart`. It keeps upstream's `{id, name, updatedAt?, birthDate?}` plus **three fork fields**: `spaceId` (non-null ⇒ Space-scoped; routes edits and thumbnails), `numberOfAssets` (the filter picker's per-row count) and `isFavorite` (`@Default(false)`, the "favorites first" tier of `comparePeople`). `updatedAt` is genuinely nullable — the old epoch-0 sentinel is gone. Upstream's dropped fields (`isHidden`, `ownerId`, `createdAt`, `color`, `thumbnailPath`, `faceAssetId`) are **not** re-added: hidden people are excluded at every source instead (server `withHidden:false` on both the global and space lists, local Drift `isHidden.equals(false)` in SQL). The photos-filter picker maps `Person` onto its own **`FilterPerson`** view model, which carries the tokenized filter id (`space-person:<id>` / `person:<id>`) — that id lives in a different value space from `Person.id`.
- **The global People page is the #727 sibling: server-sourced, not local.** For the same owner-scoped-sync reason, the global People page (`DriftPeopleCollectionPage`) can't read the local Drift `person` table (empty of shared-space people). It uses a dedicated `driftGetAllPeopleWithSharedSpacesProvider` → `DriftPeopleService.getAllPeopleWithSharedSpaces` → `PersonApiRepository.getAllPeopleWithSharedSpaces`, which pages `GET /api/people?withSharedSpaces=true` (own + timeline-enabled shared-space people, RBAC-projected server-side — same call the web People page makes) and re-sorts client-side via the shared `comparePeople` (`mobile/lib/utils/people_sort.dart`) to honour the People-page sort. **Because that sort is client-side, `_toPerson` must carry `isFavorite` off the DTO** — dropping it silently kills "favorites first" with a clean type-check. It falls back to the owner-scoped local list only on server/offline failure. Keep this **separate** from the plain `getAllPeopleProvider` / `getAllPeople` (local-only): those still feed the owner-scoped, local-first surfaces (the library people card), which intentionally must not surface shared-space people.
- **Invalidation: local is reactive, server-backed lists are not.** `getAllPeopleProvider` (renamed from `driftGetAllPeopleProvider`) is a **`StreamProvider.family<List<Person>, PeopleSortBy>`** over `DriftPeopleRepository.watch()`, so the local list updates itself and **must not be invalidated**. The server-backed lists are plain `FutureProvider`s and must be — through the single helper **`ref.invalidateServerPeopleLists()`**, which walks the `serverPeopleListProviders` registry in `people.provider.dart`. Register any new server-backed people list there rather than adding another invalidate call. It is used at five sites (`tab_shell`, `gallery_bottom_nav`, both person-edit modals, `person_picker`); the sixth, `space_people.page.dart`, deliberately keeps a family-member-scoped invalidation the argument-less helper cannot express. **Note (mobile filter-parity #473):** the photos-filter people **picker** was moved OFF the local-only source onto `driftGetAllPeopleWithSharedSpacesProvider` (see `mobile/lib/providers/photos_filter/people_picker.provider.dart`) so its search surfaces shared-space people like the People page, falling back to the local list only offline — do not revert it to `getAllPeopleProvider`. Tapping through to a shared person still reads the timeline from local Drift, same accepted limitation as the strip.
- **Edits are gated and routed exactly like web** (`person.service.ts` / `people/+page.svelte`): `PersonApiRepository._toPerson` carries `Person.spaceId` from `PersonResponseDto.primaryProfile` (non-null only for a `space-person` profile); a person is editable (rename / birthday / add-a-name / tap-through header + option sheet) iff it is personal/owned (null `spaceId`, always) **or** the viewer is an owner/editor of its space (`driftSpaceEditableProvider` → `SharedSpaceApiRepository.isSpaceEditor`, resolved optimistically — defaults to editable until known, fails open, since the server enforces the role). `DriftPeopleService.updateName/updateBirthday` (upstream's spelling fix; the fork keeps the `(Person, …)` signature because it routes on `spaceId`) branch on `spaceId`: personal → owner-only `PersonApiRepository.update` + local Drift write; space → editor-gated `SharedSpaceApiRepository.updateSpacePerson` with **no** local write (no local row exists). Never send a space-person edit to the owner-only person endpoint. Viewer-only space people render read-only (plain name, no add-a-name, no options). The face thumbnail is likewise resolved per profile via `getPersonThumbnailUrl` (used by the shared `PeopleGrid` avatar and the tap-through `PersonSliverAppBar` header): a Space person (non-null `spaceId`) routes to the membership-gated `GET /shared-spaces/{spaceId}/people/{profileId}/thumbnail`, a personal person to owner-only `GET /people/{id}/thumbnail`, mirroring web `getGlobalPersonThumbnailUrl` — the shared-space person id has no row in the owner-only `person` table, so the owner endpoint would 404.
- **Running mobile unit tests locally** (mirrors `.github/workflows/test.yml`): use Flutter **3.44.9** — the pin lives in `mobile/mise.toml` (`"aqua:flutter/flutter" = "3.44.9"`), corroborated by `mobile/pubspec.yaml` (`flutter: 3.44.9`). Read the pin rather than trusting this line; it has gone stale before. A local `mise install` may symlink an older patch under a path that self-reports the wrong version, so if in doubt invoke the binary directly from `~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/{flutter,dart}`. From `mobile/`: run `mise //mobile:codegen` (or `mise //mobile:install:ci` first if the OpenAPI client has not been generated) before `flutter test <path>`. **`dart analyze` is not a substitute for `flutter test`**: generated-code compile errors — e.g. a generator bump turning a class into a real Dart `enum`, so `.value` no longer exists — only surface when the test actually compiles.

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

## i18n

`i18n/` at the repo root is shared by web and mobile — grep both before deleting or renaming a key.

**Every change that adds or edits a user-facing string must update these nine locales in the same commit, not just `en.json`:**

`de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`

- **Editing an existing key counts.** When the English wording changes meaning, every translation of it is now wrong and must be rewritten. A stale translation is worse than a missing one: a missing key falls back to English, while a stale one confidently describes a UI that no longer exists — `filter_show_sections_hint` told nine locales to "click an icon above" after the icons had been deleted.
- **Match each file's existing register and terminology.** The German, Italian and Spanish files address the user informally (`du` / `tu` / `tú`); French and Russian use the formal `vous` / `вы`. Reuse the word the file already uses for a concept — look up the nearest existing key instead of inventing a synonym.
- **Mind gender agreement** when the subject is a noun the file already translates: `la barre latérale` and `боковая панель` are feminine, `panel boczny` masculine, so "Always compact" inflects differently in each.
- Keys are **alphabetically sorted**, 2-space indent, unescaped Unicode. Insert in place rather than appending, then run `npx prettier --write i18n/*.json` — CI checks the formatting.
- The remaining ~80 locale files are left to translators; do not hand-edit them.

## OpenAPI Workflow

When server API endpoints change:

1. Build server: `cd server && pnpm build`
2. Regenerate specs: `pnpm sync:open-api`
3. Regenerate clients: `make open-api` (generates both TypeScript SDK and Dart client)

The TypeScript SDK uses `oazapfts` for generation. The Dart client uses OpenAPI Generator with custom mustache templates and patches (Java required — see `feedback_openapi_dart_generation`) and is generated into the gitignored `mobile/generated/openapi/` at build time — it is not committed.

## Fork Branding

Upstream Immich references are rewritten to Gallery at build time by `branding/apply-branding.sh`. This runs automatically inside the Dockerfiles before `nest build` / the web build, so local `pnpm dev` and `make dev` keep upstream names in source. **Do not commit branded output**: edit the original Immich references and let the script rewrite them during Docker builds. Skipping `apply-branding` before a Docker build will leak upstream names into deployed artifacts.

## Releases & Deploys

- **Release workflows** (manual `workflow_dispatch`, triggered from `main`): mobile and server release **independently** — no draft handoff, no auto-versioning (versions are always supplied manually).
  - **Release Mobile** (`.github/workflows/gallery-release-mobile.yml`): takes a required `version`, builds + signs the Android AAB/APK and iOS IPA, uploads the AAB to Play internal and the IPA to TestFlight, keeps the APK as a workflow artifact, and records the built commit SHA in the run summary. Creates no GitHub Release or git tag.
  - **Release Gallery Server** (`.github/workflows/gallery-release-server-only.yml`): takes a required `version` and an optional `commit` (defaults to branch HEAD; pass the SHA the mobile run recorded to ship a matching build). Builds + pushes `gallery-server` / `gallery-ml` / `gallery-ml:*-cuda`, moves the `vX.Y.Z` / `vX` / `release` tags, creates the GitHub Release, and flips the version endpoint self-hosted instances poll. See `docs/plans/2026-05-18-decoupled-release-design.md`.
- **Deploy targets**: `demo.opennoodle.de` (demo), `docs.opennoodle.de` (Docusaurus). Each has a corresponding skill in `.claude/skills/` (see `/deploy-gallery-*` slash commands).
- **RC builds**: `rc-personal` skill ships a tagged server image to the personal instance via a compose override — remember to remove the override after merge or release deploys will ship stale RC images.
- **Automatic PR RC builds**: labelling a PR `rc` builds `ghcr.io/open-noodle/gallery-server:pr-<number>-rc.<n>` from the PR head on every push and keeps one sticky PR comment with tester instructions plus a history of earlier RCs; add `rc-ml` to also build `gallery-ml` under the same tag. **Tags are immutable** — `n` increments per build (resolved from the tags already in GHCR, never from the comment), so a tester can stay on or roll back to an earlier RC. There is no floating `pr-<number>` tag. All of a PR's RC images are deleted from GHCR when it closes. See `.github/workflows/gallery-pr-rc-comment.yml` and `gallery-pr-rc-cleanup.yml`.

## Contributing & Docs

- `CONTRIBUTING.md` and the README's Contributing section cover the dev-environment setup (`cp docker/example.env docker/.env`, `pnpm install`, `make dev`).
- User-facing docs live in `docs/docs/` and are deployed to `docs.opennoodle.de`. Run prettier on any markdown under `docs/` or `docs/plans/` before committing — CI Docs Build is strict.
- Guides for switching to / from Gallery live under `docs/docs/guides/` — the switch-back-to-immich script is at `scripts/revert-to-immich/`.
- The README's "What's Different from Upstream Immich" section must stay in feature parity with the marketing site (source of truth: `apps/marketing/src/data/features.ts` + `apps/marketing/src/pages/features/*.astro` in the `platform` repo) and mirror the grouping of the `noodle-gallery-vs-immich` comparison post. When a feature launches there (see the `launch-new-feature` skill), update this README too. Each feature links to `https://opennoodle.de/features/<marketing-slug>` and, where one exists, `https://docs.opennoodle.de/features/<docs-slug>` — note docs slugs can differ from marketing slugs (e.g. `dynamic-filters`→`dynamic-filter-suggestions`, `image-editing`/`video-trimming`→`editing`, `connected-libraries`→`libraries`, memories→`memories`, mobile apps→`mobile-app`).
