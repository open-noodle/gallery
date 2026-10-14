# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gallery is a community fork of [Immich](https://github.com/immich-app/immich), a self-hosted photo and video management solution. The fork is currently based on **Immich v3.3.1** and regularly rebased onto upstream. Source package names are still `immich` / `immich-web` so the rebase path stays clean — only branding, Docker image names, and fork-only code diverge.

Fork-specific features layered on top of upstream include: shared spaces, smart search & filters, user groups, S3-compatible storage, auto-classification, video duplicate detection, pet detection, Google Photos import, image editing & video trimming, and structured JSON logging. See `README.md` for the full list and docs links.

It's a monorepo managed with **pnpm workspaces** containing:

- **server/** — NestJS 11 backend (TypeScript) — package name: `immich`
- **web/** — SvelteKit frontend with Svelte 5 (TypeScript) — package name: `immich-web`
- **mobile/** — Flutter/Dart app with Riverpod state management
- **machine-learning/** — Python FastAPI service (CLIP, facial recognition, OCR, YOLO pet detection via ONNX Runtime)
- **cli/** — Node.js CLI (`@immich/cli`)
- **open-api/** — OpenAPI spec and generated SDKs (`@immich/sdk`)
- **e2e/** — End-to-end tests (Playwright + Vitest)
- **docs/** — Docusaurus site deployed to `docs.opennoodle.de` (published, user-facing content only)
- **specs/** — Internal design docs, mockups, research, and upstream-sync reports (not published)
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
mise run open-api              # Regenerate all OpenAPI clients (Dart + TypeScript) -- see OpenAPI Workflow below
mise run open-api-typescript   # Regenerate TypeScript SDK only
mise run open-api-dart         # Regenerate Dart client only
make sql                       # Sync SQL query documentation from decorated repositories
```

The `make open-api*` targets have been removed; `make open-api` now just prints a pointer to `mise run open-api`.

### Database Migrations (server/)

```bash
pnpm migrations:generate   # Auto-generate migration from schema changes (needs a fully migrated DB)
pnpm migrations:run        # Apply pending upstream + fork migrations (server migrator, needs `pnpm build`)
pnpm migrations:revert     # Revert the newest fork migration, or the newest upstream one if none is left
pnpm schema:reset          # Drop and recreate schema (destructive)
```

**Fork migration layout:** Gallery keeps migrations in two source folders and records them in two ledgers:

- `server/src/schema/migrations/`: upstream Immich migrations (replaced during rebases), recorded in `kysely_migrations`
- `server/src/schema/migrations-gallery/`: fork-only migrations (never touched by rebases), recorded in `gallery_migrations`

`kysely_migrations` therefore only ever holds upstream names, which is what a stock Immich server expects. All fork logic lives in `server/src/schema/gallery-migration-ledger.ts`; `DatabaseRepository.runMigrations()` calls it under the existing migration lock, inside one transaction:

1. **Bootstrap** (idempotent, a no-op on fresh databases): creates `gallery_migrations` if missing, applies the `renamedMigrations` map (rows earlier builds recorded under names with no file: the pre-rename `1776735180298-ChangeDurationToInteger`, RC-era fork names renumbered off timestamp collisions, and the dropped `1773846750001` stub), then moves every row named after a `migrations-gallery` file out of `kysely_migrations`. It logs one `Migration ledgers: … renamed, … deleted, … moved` line (log level when anything changed, debug otherwise), and refuses an upstream row with no file, i.e. a database migrated by an Immich newer than the base, with an error naming that row and the newest upstream migration this build ships. **The map is load-bearing**: Kysely hard-fails on boot when a recorded name has no file. `1777667825574-ChangeDurationToInteger` also keeps the fork's guard (a no-op when `asset.duration` is already integer) as defence for any database state the map does not foresee; upstream never edits a released migration, so the hunk costs nothing at rebase time. That guard and the `IF NOT EXISTS` in `1775165531374-AddPersonNameTrigramIndex` are the fork's only edits to upstream migration files. Add an entry whenever a migration that has shipped anywhere (including RC/staging) is renamed. A renamed row is also re-stamped to at least the newest timestamp of the upstream rows named before it, because a stock Immich migrator (`allowUnorderedMigrations: false`) requires executed rows sorted by `(timestamp, name)` to match file order. Upstream rows recorded out of name order for any other reason still block a stock Immich boot.
2. **One run in name order across both folders**, each migration recorded in its own ledger. The single order matters: a Gallery database from before upstream's `ClusterGroups` must drop its fork FKs (`1787100000000`) before `1787148183729-ClusterGroups` runs, or that migration fails with `2BP01`. Both migrators keep `allowUnorderedMigrations: true`, because rolling-branch databases recorded some migrations out of name order.

**`sql-tools` cannot drive the fork ledger**: it hardcodes `kysely_migrations`. `migrations:run` / `migrations:revert` / `schema:reset` therefore go through `server/src/bin/gallery-migrations.ts` (the server migrator), not `sql-tools`. `migrations:generate` still uses `sql-tools`; it diffs code against the database and imports all of `dist/schema`, so it only needs a database migrated by `migrations:run`. The ORDER manifests and `migrations:verify-order:gallery` are folder-scoped and unaffected. The `postbuild` hook (`server/bin/sync-gallery-migrations.mjs`) deletes compiled migrations in `dist/schema/` that no longer have a source file, because `nest build` never empties `dist/` and a stale file would be run.

**Switching and reverting:** an Immich-to-Gallery switch needs no bootstrap work; every fork migration simply runs after the upstream ones already applied. `scripts/revert-to-immich.sql` step 8 drops `gallery_migrations` and `gallery_migrations_lock`, and keeps its `kysely_migrations` DELETE list for databases last booted by a build from before the split.

**Downgrading to a build from before the split** fails on boot: that build looks for fork rows in `kysely_migrations`, finds none, and re-runs a non-idempotent fork migration, so boot aborts with `relation "storage_migration_log" already exists` (from `1772230000000-CreateStorageMigrationLogTable`; the transaction rolls back, no data is lost). Copy the fork rows back first; when this build boots again it moves them out of `kysely_migrations` once more:

```sql
INSERT INTO "kysely_migrations" ("name", "timestamp") SELECT "name", "timestamp" FROM "gallery_migrations" ON CONFLICT ("name") DO NOTHING;
```

**Adding new fork migrations:** Create new migration files in `server/src/schema/migrations-gallery/` with a timestamp that doesn't collide with existing migrations. Number it above the newest upstream migration name in `server/src/schema/migrations/` unless it is a deliberate pre-step for a known upstream migration, like `1787100000000-DropPersonFksBeforeClusterGroups`: a fork migration numbered below an upstream one runs mid-stream on fresh installs but last on existing databases. Use round timestamps (e.g., `1798000000000`) for easy identification. Every fork foreign key onto an upstream key is listed in `server/src/schema/gallery-upstream-fks.json`, grouped by the upstream key it depends on; `src/schema/gallery-upstream-fks.spec.ts` fails until a new one is added there. An upstream migration that drops or rebuilds a listed key fails with `2BP01`, as `ClusterGroups` did, so the upstream preflight report flags any incoming upstream migration that drops or renames a listed key or changes its table or column. Plan the pre/post fork migration pair (drop the dependent FKs before the upstream migration, recreate them after it) when that batch is taken. The largest exposure is `person_group_pkey`, the key `ClusterGroups` rebuilt: five fork FKs hang off it (`face_person_verdict_personGroupId_fkey`, `face_repair_decline_personGroupId_fkey`, `face_repair_decline_suspectedOwnerId_fkey`, `person_identity_personGroupId_fkey`, `person_pet_personGroupId_fkey`; the last two came with the person sidecars), so an upstream rebuild of `person_group` needs a pair covering all five.

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
- **Fork seams in upstream server code.** `src/gallery/` mirrors upstream's `src/` layout (`controllers/`, `dtos/`, `repositories/`, `services/`, `utils/`), with `index.ts` registering its controllers, services and repositories; put a new fork file in the folder upstream would use. Upstream files keep one call into a fork module: `checkAccess` unions the widening grants in `src/gallery/utils/access-grants.ts` once, over the ids upstream did not grant (narrowing stays inline: `checkSharedLinkAccess` and the `Person*` cases), and the fork access queries live in `src/gallery/repositories/access.repository.ts`, mounted as `access.spaceAsset`, `spaceAlbum`, `galleryPerson` and `sharedSpace`. `test/medium/specs/utils/access-oracle.medium.spec.ts` snapshots the granted ids for every `Permission`; a new upstream permission adds an entry to review, then accept with `-u`. `BaseService` builds `this.backendMedia` (`src/gallery/utils/backend-media-server.ts`: serving from disk or S3, local staging, face crops). `AssetService.get` calls `applyAssetResponseOverlay`; the favorites and editable routes live in `GalleryAssetController`, mounted before `AssetController`. Fork search fields are extension shapes in `src/gallery/dtos/search.dto.ts`, one extend or spread per upstream schema; that module stays a leaf. Fork sync streams live in `src/gallery/utils/gallery-sync.streams.ts` (queries in `src/gallery/repositories/gallery-sync.repository.ts`) behind `GallerySyncStreams` (`handlers`, `order`, `cleanupAuditTables`, `isForkAwareClient`, `syncedMemoryTypes`).
- **Stock clients see the upstream base version.** `src/gallery/utils/client-version.ts` classifies each request and socket: a Gallery client sends `x-gallery-app` (web: SDK default header plus the socket.io handshake `auth`, since browsers cannot set websocket headers; mobile: Dart `ApiClient` default header plus `NetworkRepository.setHeaders`, which the native OkHttp/URLSession clients apply to every call and the websocket; CLI: SDK init) or an app User-Agent of major 5 or higher. Everyone else (stock Immich apps, stock CLI, third-party tools) gets the Immich base from `GET /server/version` (`Vary: User-Agent, X-Gallery-App`) and `on_server_version`, never gets `on_new_release`, and gets `AssetEditReadyV2` without trim edits. Socket sends that differ by client go through `WebsocketRepository.clientSendByClient`. The base comes from `immichVersion` in `server/package.json`, which `apply-branding.sh` `patch_versions` keeps from the source version before stamping the Gallery version; `verify-branding.sh` checks it equals `branding/config.json` `upstream.version`. The major-5 rule stops working if Immich reaches 5.0.

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
- **Fork seams in upstream mobile code.** Fork timeline queries live in `SharedSpaceTimelineRepository` (`shared_space_timeline.repository.dart`, a `part of` `timeline.repository.dart`, plus `data/db/main/query/shared_space_timeline.drift`). `timeline.repository.dart` keeps these fork hunks: three imports and the `part`; an optional `extraWhere` on the four album builders (the temporal scope enters there); both `GroupAssetsBy.none` counts rewritten as counts through the asset join so `extraWhere` applies, the remote one adding `deletedAt IS NULL` and `watchSingle()` so it matches the grouped buckets (do not restore upstream's album-row count on a rebase); the `GroupAssetsBy.year` arms; a class comment marking the upstream-shaped routes (`main()`, `favorite()`, ...) unused, since `main()` drops Space assets. Fork sync entity types are dispatched through the `gallerySyncHandlers` map in `gallery_sync_stream.repository.dart`, which `SyncStreamService` consults for every type its upstream switch does not handle. A type with no handler is logged and skipped, and the batch is still acked, so its data is lost until a full reset: the enum-driven test in `sync_stream_service_test.dart` fails for any `SyncEntityType` that reaches neither repository.
- **Faces/people are local-first, and sync is owner-scoped.** The asset-viewer people strip (`people_details.widget.dart` → `driftPeopleAssetProvider` → `DriftPeopleRepository.getAssetPeople`) reads faces from the local Drift DB. The `person`/`asset_face` sync streams (`sync.repository.ts` `PersonSync`/`AssetFaceSync`) filter `ownerId = userId`, so a viewer never syncs faces for assets shared with them through a Space — unlike the web app, which fetches asset detail on demand (`AssetService.get`) and resolves those faces to the Space's people. For non-owned assets the mobile people strip therefore fetches from the asset-info endpoint (`PersonApiRepository.getAssetPeople`) to match web (issue #727); those server-resolved people are read-only on the strip, so the inline add-a-name / rename affordance is gated to owned assets. Tapping through to a shared person's own page still hits local Drift and remains limited. The **memory lane** is the same shape (#997): `memory`/`memory_asset` sync is owner-scoped too, so `MemoryApiRepository.getMemoryLane` reads `GET /memories` and falls back to the owner-scoped local query only on server/offline failure. `GET /memories/{id}` stays owner-only server-side, so the by-id memory deep link remains local-only — web has the same limitation.
- **One unified `Person` model (upstream #30659/#30660/#30662, reconciled 2026-08-13).** `PersonDto` and `DriftPerson` were collapsed into a single `Person` in `mobile/lib/domain/models/person.model.dart`. It keeps upstream's `{id, name, updatedAt?, birthDate?}` plus **three fork fields**: `spaceId` (non-null ⇒ Space-scoped; routes edits and thumbnails), `numberOfAssets` (the filter picker's per-row count) and `isFavorite` (`@Default(false)`, the "favorites first" tier of `comparePeople`). `updatedAt` is genuinely nullable — the old epoch-0 sentinel is gone. Upstream's dropped fields (`isHidden`, `ownerId`, `createdAt`, `color`, `thumbnailPath`, `faceAssetId`) are **not** re-added: hidden people are excluded at every source instead (server `withHidden:false` on both the global and space lists, local Drift `isHidden.equals(false)` in SQL). The photos-filter picker maps `Person` onto its own **`FilterPerson`** view model, which carries the tokenized filter id (`space-person:<id>` / `person:<id>`) — that id lives in a different value space from `Person.id`.
- **The global People page is the #727 sibling: server-sourced, not local.** For the same owner-scoped-sync reason, the global People page (`DriftPeopleCollectionPage`) can't read the local Drift `person` table (empty of shared-space people). It uses a dedicated `driftGetAllPeopleWithSharedSpacesProvider` → `PeopleService.getAllPeopleWithSharedSpaces` → `PersonApiRepository.getAllPeopleWithSharedSpaces`, which pages `GET /api/people?withSharedSpaces=true` (own + timeline-enabled shared-space people, RBAC-projected server-side — same call the web People page makes) and re-sorts client-side via the shared `comparePeople` (`mobile/lib/utils/people_sort.dart`) to honour the People-page sort. **Because that sort is client-side, `_toPerson` must carry `isFavorite` off the DTO** — dropping it silently kills "favorites first" with a clean type-check. It falls back to the owner-scoped local list only on server/offline failure. Keep this **separate** from the plain `getAllPeopleProvider` / `getAllPeople` (local-only): those still feed the owner-scoped, local-first surfaces (the library people card), which intentionally must not surface shared-space people.
- **Invalidation: local is reactive, server-backed lists are not.** `getAllPeopleProvider` (renamed from `driftGetAllPeopleProvider`) is a **`StreamProvider.family<List<Person>, PeopleSortBy>`** over `DriftPeopleRepository.watch()`, so the local list updates itself and **must not be invalidated**. The server-backed lists are plain `FutureProvider`s and must be — through the single helper **`ref.invalidateServerPeopleLists()`**, which walks the `serverPeopleListProviders` registry in `people.provider.dart`. Register any new server-backed people list there rather than adding another invalidate call. It is used at five sites (`tab_shell`, `gallery_bottom_nav`, both person-edit modals, `person_picker`); the sixth, `space_people.page.dart`, deliberately keeps a family-member-scoped invalidation the argument-less helper cannot express. **Note (mobile filter-parity #473):** the photos-filter people **picker** was moved OFF the local-only source onto `driftGetAllPeopleWithSharedSpacesProvider` (see `mobile/lib/providers/photos_filter/people_picker.provider.dart`) so its search surfaces shared-space people like the People page, falling back to the local list only offline — do not revert it to `getAllPeopleProvider`. Tapping through to a shared person still reads the timeline from local Drift, same accepted limitation as the strip.
- **Edits are gated and routed exactly like web** (`person.service.ts` / `people/+page.svelte`): `PersonApiRepository._toPerson` carries `Person.spaceId` from `PersonResponseDto.primaryProfile` (non-null only for a `space-person` profile); a person is editable (rename / birthday / add-a-name / tap-through header + option sheet) iff it is personal/owned (null `spaceId`, always) **or** the viewer is an owner/editor of its space (`driftSpaceEditableProvider`, which reads the viewer's own row from `sharedSpacesProvider` via `spaceIsWritable`; resolved optimistically — defaults to editable until known, fails open, since the server enforces the role). `PeopleService.updateName/updateBirthday` (upstream's spelling fix; the fork keeps the `(Person, …)` signature because it routes on `spaceId`) branch on `spaceId`: personal → owner-only `PersonApiRepository.update` + local Drift write; space → editor-gated `SharedSpaceApiRepository.updateSpacePerson` with **no** local write (no local row exists). Never send a space-person edit to the owner-only person endpoint. Viewer-only space people render read-only (plain name, no add-a-name, no options). The face thumbnail is likewise resolved per profile via `getPersonThumbnailUrl` (used by the shared `PeopleGrid` avatar and the tap-through `PersonSliverAppBar` header): a Space person (non-null `spaceId`) routes to the membership-gated `GET /shared-spaces/{spaceId}/people/{profileId}/thumbnail`, a personal person to owner-only `GET /people/{id}/thumbnail`, mirroring web `getGlobalPersonThumbnailUrl` — the shared-space person id has no row in the owner-only `person` table, so the owner endpoint would 404.
- **Date-only query params must be hand-formatted.** The generated Dart client serialises every `DateTime` query param as a full ISO timestamp, which any endpoint validating `format: date` rejects with a 400 — e.g. `GET /memories?for=`. Build `YYYY-MM-DD` by hand (not with `intl`, whose digits follow the ambient locale) and send it via `ApiClient.invokeAPI`. Dropping such a filter is rarely free: without `for`, `/memories` stops applying `hideAt` and returns the whole retention window (365 days by default) with every asset attached.
- **Running mobile unit tests locally** (mirrors `.github/workflows/test.yml`): read the Flutter version from `mobile/mise.toml` (the `[tools."aqua:flutter/flutter"]` table's `version`), cross-checked against `mobile/pubspec.yaml`'s `flutter:` key. **This line deliberately does not name a version** — it has stated a wrong one twice, most recently when upstream moved the pin and this paragraph was edited to a different wrong value in the same cycle. A local `mise install` may symlink an older patch under a path that self-reports the wrong version, so if in doubt invoke the binary directly from `~/.local/share/mise/installs/aqua-flutter-flutter/<version>/flutter/bin/{flutter,dart}`. From `mobile/`: run `mise //mobile:codegen` (or `mise //mobile:install:ci` first if the OpenAPI client has not been generated) before `flutter test <path>`. **`dart analyze` is not a substitute for `flutter test`**: generated-code compile errors — e.g. a generator bump turning a class into a real Dart `enum`, so `.value` no longer exists — only surface when the test actually compiles.

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

## Commit Messages & PR Descriptions

**Never refer to an upstream Immich PR with a form GitHub autolinks.** This repo is a **fork of
`immich-app/immich`**, so GitHub resolves a bare `#30881` against the **parent** repo and files an
"added a commit that referenced this pull request" event on Immich's PR. The rolling rebase branch
replays every fork commit under a new SHA each cycle, so one such reference re-notifies that
upstream PR on **every force-push** — it is not a one-off.

| Write this                        | Never this                                                     |
| --------------------------------- | -------------------------------------------------------------- |
| `immich-30881`                    | `#30881` · `PR#30881` · `GH-30881` · `immich-app/immich#30881` |
| `sveltejs/svelte 18546`           | `sveltejs/svelte#18546`                                        |
| `xneo1/portainer_templates PR 13` | a `github.com/<other-repo>/pull/13` URL                        |

**Our own `#NNN` stays** — a fork PR or issue number resolves inside this repo and is the normal,
useful case. Only numbers above our own PR numbering, and any explicit `owner/repo#N` or foreign
issue/PR URL, cause the problem.

This applies to **commit messages, PR titles and PR descriptions** — all three create
cross-references. Ordinary file contents do not, so `specs/upstream-reports/*.md` may cite `#30900`
freely.

To check a branch, grep its own commits — anything this prints is a reference that will notify
another repo (5+ digits, because Immich is well past 30000 while our own PR numbers are 4-digit):

```bash
git log origin/main..HEAD --format=%B | grep -nE '(^|[^0-9A-Za-z_/-])#[0-9]{5,}|[a-z0-9._-]+/[a-z0-9._-]+#[0-9]+'
```

The rolling rebase branch also carries `make commit-autolink-check`, which covers every autolink
form GitHub honours; it reaches `main` at the next upstream cutover.

## i18n

`i18n/` at the repo root is shared by web and mobile. Grep both before deleting or renaming a key.

**`i18n/*.json` are upstream's files and stay byte-identical to the upstream tag** (`git diff refs/upstream/vX.Y.Z -- i18n/*.json` is empty). Never edit them: every fork string lives in the overlay `i18n/gallery/<locale>.json`. `i18n/gallery/merge.mjs` merges the two into the gitignored `i18n/gallery/merged/`, which is what everything reads: web's `$i18n` alias (built whenever `web/svelte.config.js` loads, rebuilt on change in `vite dev`), mobile codegen (`mise //mobile:codegen`, task `i18n:merge`), and the key-checking specs in web, server and mobile. `apply-branding.sh` folds the overlay into `i18n/*.json` before branding. Design and the Weblate setup: `specs/2026-10-11-i18n-overlay-design.md`.

- **New fork string:** add the key to `i18n/gallery/en.json` and the nine locales below.
- **Rewording an upstream string:** put the new text in the overlay (en plus the nine) and list the key in `i18n/gallery/overrides.txt`. On any unlisted collision upstream wins. Add `exclusive` when the meaning changed, so locales the overlay does not translate drop upstream's stale translation and fall back to English.
- **Replacing only the translations of an upstream string** (English unchanged): list the key with `en:<hash>`; `--check` prints the tag. It pins upstream's English, so a rewording upstream fails the check until the translations are reviewed and the tag updated.
- `node i18n/gallery/merge.mjs --check` (CI's "Test i18n" job) fails on overlay entries upstream now defines, on `overrides.txt` lines for keys upstream removed, and on a translation-only line whose `en:` tag no longer matches upstream's English. Resolve each at rebase time: delete the overlay entry, list the key, or review the translations and update the tag.
- Brand names are not overlay strings: `branding/i18n/` rewrites keys of the folded bundle at Docker build time. Keep upstream's wording in the overlay and put brand replacements there.

**Every change that adds or edits a user-facing string must update these nine overlay locales in the same commit, not just `i18n/gallery/en.json`:**

`de` · `fr` · `it` · `nl` · `pl` · `es` · `ru` · `zh_Hans` · `zh_Hant`

- **Editing an existing key counts.** When the English wording changes meaning, every translation of it is now wrong and must be rewritten. A stale translation is worse than a missing one: a missing key falls back to English, while a stale one confidently describes a UI that no longer exists — `filter_show_sections_hint` told nine locales to "click an icon above" after the icons had been deleted.
- **Match each file's existing register and terminology.** The German, Italian and Spanish files address the user informally (`du` / `tu` / `tú`); French and Russian use the formal `vous` / `вы`. Reuse the word the file already uses for a concept — look up the nearest existing key instead of inventing a synonym.
- **Mind gender agreement** when the subject is a noun the file already translates: `la barre latérale` and `боковая панель` are feminine, `panel boczny` masculine, so "Always compact" inflects differently in each.
- Keys are **alphabetically sorted**, 2-space indent, unescaped Unicode. Insert in place rather than appending, then run `npx prettier --write i18n/`, which covers the overlay. CI checks the formatting.
- Gallery has no translation service of its own: fork strings in the other locales fall back to English, and only the nine above are maintained. Upstream's strings in every locale arrive with each rebase, translated through Immich's Weblate.

## OpenAPI Workflow

When server API endpoints change:

1. Build server: `cd server && pnpm build`
2. Regenerate specs: `mise run //server:sync-open-api`
3. Regenerate clients: `mise run open-api-typescript` and `mise run open-api-dart` (or `mise run open-api` from the repo root to do both, plus steps 1–2, in one go)

The TypeScript SDK uses `oazapfts` for generation. The Dart client uses OpenAPI Generator with custom mustache templates and patches (Java required — see `feedback_openapi_dart_generation`) and is generated into the gitignored `mobile/generated/openapi/` at build time — it is not committed.

## Fork Branding

Upstream Immich references are rewritten to Gallery at build time by `branding/apply-branding.sh`. This runs automatically inside the Dockerfiles before `nest build` / the web build, so local `pnpm dev` and `make dev` keep upstream names in source. **Do not commit branded output**: edit the original Immich references and let the script rewrite them during Docker builds. Skipping `apply-branding` before a Docker build will leak upstream names into deployed artifacts.

## Releases & Deploys

- **Release workflows** (manual `workflow_dispatch`, triggered from `main`): mobile and server release **independently** — no draft handoff, no auto-versioning (versions are always supplied manually).
  - **Release Mobile** (`.github/workflows/gallery-release-mobile.yml`): takes a required `version`, builds + signs the Android AAB/APK and iOS IPA, uploads the AAB to Play internal and the IPA to TestFlight, keeps the APK as a workflow artifact, and records the built commit SHA in the run summary. Creates no GitHub Release or git tag.
  - **Release Gallery Server** (`.github/workflows/gallery-release-server-only.yml`): takes a required `version` and an optional `commit` (defaults to branch HEAD; pass the SHA the mobile run recorded to ship a matching build). Builds + pushes `gallery-server` / `gallery-ml` / `gallery-ml:*-cuda`, moves the `vX.Y.Z` / `vX` / `release` tags, creates the GitHub Release, and flips the version endpoint self-hosted instances poll. See `specs/2026-05-18-decoupled-release-design.md`.
- **Deploy targets**: `demo.opennoodle.de` (demo), `docs.opennoodle.de` (Docusaurus). Each has a corresponding skill in `.claude/skills/` (see `/deploy-gallery-*` slash commands).
- **RC builds**: `rc-personal` skill ships a tagged server image to the personal instance via a compose override — remember to remove the override after merge or release deploys will ship stale RC images.
- **Automatic PR RC builds**: labelling a PR `rc` builds `ghcr.io/open-noodle/gallery-server:pr-<number>-rc.<n>` from the PR head on every push and keeps one sticky PR comment with tester instructions plus a history of earlier RCs; add `rc-ml` to also build `gallery-ml` under the same tag. **Tags are immutable** — `n` increments per build (resolved from the tags already in GHCR, never from the comment), so a tester can stay on or roll back to an earlier RC. There is no floating `pr-<number>` tag. All of a PR's RC images are deleted from GHCR when it closes. See `.github/workflows/gallery-pr-rc-comment.yml` and `gallery-pr-rc-cleanup.yml`.

## Internal Design Docs (`specs/`)

`specs/` holds the fork's internal engineering record. It is deliberately **outside `docs/`** so it is
neither published to `docs.opennoodle.de`, prettier-gated, nor a trigger for the Docs Build workflow.

```
specs/                      design docs — one per feature/decision, durable
specs/mockups/              HTML mockups and visual explorations (some are cited from web/src)
specs/research/             feature research and prior-art notes
specs/upstream-reports/     per-cycle upstream rebase reports
specs/testing/              manual test plans
```

**Naming:** `YYYY-MM-DD-<topic>-design.md` for designs; keep the date of the _original_ decision when
revising, so the filename stays a stable citation target.

**What belongs here — the test is lifespan, not format.** Write a doc here when it explains _why_ the
code is shaped the way it is, and will still be true after the PR merges: designs, decision records,
diagnoses, permission matrices, research. Code may cite these by path (`grep -rn 'specs/' server/src web/src`),
which only works because they live in-tree at the same commit as the code they explain.

**What does NOT belong here:** slice-by-slice implementation plans, execution checklists, session
handoffs, task lists, and "future improvements" wishlists. They expire the moment the work lands and
then actively mislead — write them to a scratch directory instead. If something in a plan is worth
keeping, fold it into the design doc or the PR description before you finish.

**Pruning is expected.** `git log --diff-filter=D -- specs/` retrieves anything deleted, so deleting a
doc that has gone stale loses nothing. A stale doc that stays costs every future search.

## Contributing & Docs

- `CONTRIBUTING.md` and the README's Contributing section cover the dev-environment setup (`cp docker/example.env docker/.env`, `pnpm install`, `make dev`).
- User-facing docs live in `docs/docs/` and are deployed to `docs.opennoodle.de`. Run prettier on any markdown under `docs/` before committing — CI Docs Build is strict. `specs/` is outside `docs/` precisely so it is _not_ prettier-gated and does not trigger the Docs Build workflow.
- Guides for switching to / from Gallery live under `docs/docs/guides/` — the switch-back-to-immich script is at `scripts/revert-to-immich/`.
- The README's "What's Different from Upstream Immich" section must stay in feature parity with the marketing site (source of truth: `apps/marketing/src/data/features.ts` + `apps/marketing/src/pages/features/*.astro` in the `platform` repo) and mirror the grouping of the `noodle-gallery-vs-immich` comparison post. When a feature launches there (see the `launch-new-feature` skill), update this README too. Each feature links to `https://opennoodle.de/features/<marketing-slug>` and, where one exists, `https://docs.opennoodle.de/features/<docs-slug>` — note docs slugs can differ from marketing slugs (e.g. `dynamic-filters`→`dynamic-filter-suggestions`, `image-editing`/`video-trimming`→`editing`, `connected-libraries`→`libraries`, memories→`memories`, mobile apps→`mobile-app`).
