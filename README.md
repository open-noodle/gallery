<p align="center">
  <br/>
  <a href="https://opensource.org/license/agpl-v3"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?color=3F51B5&style=for-the-badge&label=License&logoColor=000000&labelColor=ececec" alt="License: AGPLv3"></a>
  <a href="https://discord.gg/cxBfbuxyG4">
    <img src="https://img.shields.io/discord/1480633426376921239.svg?label=Discord&logo=Discord&style=for-the-badge&logoColor=000000&labelColor=ececec" alt="Discord"/>
  </a>
  <br/>
  <br/>
</p>

<p align="center">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="design/gallery-logo-stacked-dark.svg">
  <img src="design/gallery-logo-stacked-light.svg" width="390" alt="Noodle Gallery logo" title="Noodle Gallery Logo">
</picture>
</p>
<h3 align="center">High performance self-hosted photo and video management solution</h3>
<h4 align="center">
  <a href="https://opennoodle.de/install">Install in 5 minutes</a>
  ·
  <a href="https://demo.opennoodle.de">Try the live demo</a>
</h4>
<br/>

<p align="center">
  <a href="https://demo.opennoodle.de">
    <img src="design/gallery-screenshot.webp" width="100%" alt="The Noodle Gallery photo timeline, with Shared Spaces in the sidebar, the filter panel open, and generated trip memories across the top">
  </a>
</p>

> [!NOTE]
> This is a **community fork** of [Immich](https://github.com/immich-app/immich) with additional features and improvements. Currently based on **Immich v3.1.0**. We regularly sync with upstream to stay up to date. See [What's Different](#whats-different-from-upstream-immich) below.

> [!TIP]
> **Already running Immich?** Switching to Gallery is a three-line config change — two image names in your `docker-compose.yml` and `IMMICH_VERSION=v5` in your `.env`. Your library and database are fully compatible. See the [install guide](https://opennoodle.de/install/#migrate-from-immich).
>
> **Not for you?** A one-command [switch-back script](https://docs.opennoodle.de/guides/switch-back-to-immich) cleans up Gallery-specific tables and columns and puts you back on upstream Immich. Your photos and videos never move.

## What's Different from Upstream Immich

Gallery is a friendly fork that **rebases onto every upstream Immich release**, so every fix, performance improvement, and new feature from the Immich team lands here automatically. On top of that foundation, Gallery adds the features below — grouped the way the [Noodle Gallery vs Immich](https://opennoodle.de/noodle-gallery-vs-immich) comparison frames them: each is an additive answer to a place where upstream runs out of room. Every feature has a [feature page](https://opennoodle.de/features), and most have a [docs page](https://docs.opennoodle.de/) too.

### People and identity

Immich's face recognition is account-scoped — the same person shows up as a separate entry in your library, your partner's, and every shared album you both touch.

- **[Global People](https://opennoodle.de/features/global-people)** — people, filters, and search results dedupe across your library and every Shared Space you can access, without crossing a permission boundary. Naming and merging stay scoped to where they were entered.

### Sharing and collaboration

Partner Sharing is all-or-nothing and albums belong to whoever made them — there's no combined family timeline, no activity log, and no way to bulk-share tens of thousands of photos by hand.

- **[Shared Spaces](https://opennoodle.de/features/shared-spaces)** — multi-owner collaborative timelines with Owner / Editor / Viewer roles, cross-contributor face recognition, and a per-space activity log. Photos are linked by reference at zero extra storage cost, and each contributor keeps their own library. ([Docs](https://docs.opennoodle.de/features/shared-spaces))
- **[Spaces Filtering](https://opennoodle.de/features/spaces-filtering)** — the full filter suite (date, people, location, camera, tags) scoped to a single Space.
- **[User Groups](https://opennoodle.de/features/user-groups)** — named, color-coded groups so you can share with a whole circle at once. ([Docs](https://docs.opennoodle.de/features/user-groups))
- **[Bulk Add to Spaces](https://opennoodle.de/features/bulk-add)** — add hundreds of thousands of photos to a Space in one click, processed in the background.

### Search and discovery

Each page has its own search bar with no keyboard-first global entry point, smart-search results can't be sorted or threshold-tuned, filters operate in isolation, and the map has no filter panel of its own.

- **[Timeline Grouping](https://opennoodle.de/features/timeline-grouping)** — a Years / Months / All switcher on every timeline. Zoom into a period without restricting the query, and keep your scroll position when you switch back.
- **[Inline Search Filters](https://opennoodle.de/features/inline-search-filters)** — type structured filters (people, tags, dates, locations, ratings, cameras) straight into the search bar, with live suggestions and shareable URL state.
- **[Global Search](https://opennoodle.de/features/global-search)** — <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> searches people, places, tags, albums, commands, and settings in parallel. ([Docs](https://docs.opennoodle.de/features/search-palette))
- **[Search Palette](https://opennoodle.de/features/search-palette)** — the command palette behind it, with [prefix shortcuts](https://opennoodle.de/features/search-scope-prefixes) (`@` people, `#` tags, `/` albums, `>` commands) and [page commands](https://opennoodle.de/features/page-commands) for rename / share / delete. ([Docs](https://docs.opennoodle.de/features/search-palette))
- **[Search Sorting & Relevance](https://opennoodle.de/features/search-sorting)** — sort by relevance, newest, or oldest, with a tunable similarity threshold.
- **[Interdependent Filtering](https://opennoodle.de/features/dynamic-filters)** — every filter narrows every other filter, so there are no dead-end combinations. ([Docs](https://docs.opennoodle.de/features/dynamic-filter-suggestions))
- **[Smart Search & Contextual Filters](https://opennoodle.de/features/smart-search-filters)** — full-text and CLIP search inside Spaces, with filter suggestions that adapt to your selection.
- **[Map Filtering](https://opennoodle.de/features/map-filtering)** — the full filter panel on the Map view, with markers updating in real time. ([Docs](https://docs.opennoodle.de/features/map-filtering))

### AI and automation

Immich's AI surface is focused on faces and basic CLIP search — pets aren't detected, memories show only "On This Day", there's no automated clutter suppression, and duplicate detection misses re-encoded videos.

- **[Auto-Classification](https://opennoodle.de/features/auto-classification)** — define what clutter looks like (screenshots, memes, receipts) and Gallery tags and optionally archives it automatically, each category with its own threshold. ([Docs](https://docs.opennoodle.de/features/auto-classification))
- **[Memories Archive](https://opennoodle.de/features/memories-archive)** — a dedicated Memories page with search, an All/Saved filter, and retention controls. ([Docs](https://docs.opennoodle.de/features/memories))
- **[Smarter Memories](https://opennoodle.de/features/smarter-memories)** — recent-trip recaps detected from location clusters, plus birthday memories that adapt to each person's photo history. ([Docs](https://docs.opennoodle.de/features/memories))
- **[Pet Detection](https://opennoodle.de/features/pet-detection)** — YOLO11 detects dogs, cats, birds, and other animals and surfaces them alongside people. ([Docs](https://docs.opennoodle.de/features/pet-detection))
- **[Video Duplicate Detection](https://opennoodle.de/features/video-duplicate-detection)** — averages CLIP embeddings across sampled frames, catching duplicate videos even after re-encoding or resizing. ([Docs](https://docs.opennoodle.de/features/video-duplicate-detection))

### Media management and migration

Trimming a video means exporting to an external tool, moving from Google Photos needs CLI scripts, storage is local disk or external libraries with no native S3 backend, and a large existing library can't be linked into a shared collection.

- **[Image Editing](https://opennoodle.de/features/image-editing)** — non-destructive rotation and cropping from the asset viewer, plus batch rotate. Originals are always preserved. ([Docs](https://docs.opennoodle.de/features/editing))
- **[Video Trimming](https://opennoodle.de/features/video-trimming)** — cut clips in the browser. FFmpeg stream copy makes it instant and lossless, and you can restore the original at any time. ([Docs](https://docs.opennoodle.de/features/editing))
- **[Connected Libraries](https://opennoodle.de/features/connected-libraries)** — link external photo libraries into Shared Spaces with no file duplication and originals left untouched. ([Docs](https://docs.opennoodle.de/features/libraries))
- **[Google Photos Import](https://opennoodle.de/features/google-photos-import)** — a guided in-browser wizard for Takeout archives that preserves dates, GPS, descriptions, and album structure. No CLI required. ([Docs](https://docs.opennoodle.de/features/google-photos-import))
- **[S3-Compatible Storage](https://opennoodle.de/features/s3-storage)** — store media on any S3-compatible backend (AWS S3, MinIO, Cloudflare R2, Backblaze B2, Wasabi), with a built-in [migration tool](https://docs.opennoodle.de/features/storage-migration) that resumes and rolls back. ([Docs](https://docs.opennoodle.de/features/s3-storage))

### Mobile

Filtering the timeline in the Immich mobile app means switching to a separate tab and losing your scroll position, and advanced surfaces sit deeper in the app or aren't there at all.

- **[Photos Filtering on Mobile](https://opennoodle.de/features/mobile-photos-filtering)** — a bottom sheet filters the timeline by people, places, tags, dates, rating, and media type without leaving the grid.
- **[iPhone](https://opennoodle.de/features/ios-app)** and **[Android](https://opennoodle.de/features/android-app)** — native apps on the [App Store](https://apps.apple.com/us/app/noodle-gallery/id6761776289) and [Google Play](https://play.google.com/store/apps/details?id=de.opennoodle.gallery), with background camera backup, on-device CLIP search, the map, and Shared Spaces — all talking directly to your own server. ([Docs](https://docs.opennoodle.de/features/mobile-app))

### Operations

- **Structured JSON logging** — opt-in JSON log output (`IMMICH_LOG_FORMAT=json`) for clean integration with log aggregation systems like Grafana Loki, the ELK Stack, Datadog, or Splunk.

---

## Switching to This Fork

Switching is simple — just change your Docker image names. Your existing database, configuration, and media files are fully compatible.

### Step 1: Back Up Your Database

> [!IMPORTANT]
> Always back up your database before switching. This allows you to revert to upstream Immich if needed.

```bash
docker exec -t immich_postgres pg_dumpall -c -U postgres | gzip > immich-db-backup-$(date +%Y%m%d).sql.gz
```

### Step 2: Update Your Docker Compose File

Set the version in your `.env` file:

```bash
IMMICH_VERSION=v5
```

Change the image references in your `docker-compose.yml`:

```diff
services:
  immich-server:
-   image: ghcr.io/immich-app/immich-server:${IMMICH_VERSION:-release}
+   image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}

  immich-machine-learning:
-   image: ghcr.io/immich-app/immich-machine-learning:${IMMICH_VERSION:-release}
+   image: ghcr.io/open-noodle/gallery-ml:${IMMICH_VERSION:-release}
```

For NVIDIA GPU acceleration on the ML container, use the `-cuda` tag variant:

```yaml
image: ghcr.io/open-noodle/gallery-ml:${IMMICH_VERSION:-release}-cuda
```

### Step 3: Restart

```bash
docker compose pull
docker compose up -d
```

That's it. To switch back to upstream Immich later, flip the two image names back and either restore your database backup or run the [automated switch-back script](https://docs.opennoodle.de/guides/switch-back-to-immich), which drops Gallery-specific tables, columns, and migration records — shared spaces, pet detection, classifications, duplicate data — leaving a plain upstream Immich database. Your photos and videos are never touched.

---

<p align="center">
  <a href="readme_i18n/README_ca_ES.md">Català</a>
  <a href="readme_i18n/README_es_ES.md">Español</a>
  <a href="readme_i18n/README_fr_FR.md">Français</a>
  <a href="readme_i18n/README_it_IT.md">Italiano</a>
  <a href="readme_i18n/README_ja_JP.md">日本語</a>
  <a href="readme_i18n/README_ko_KR.md">한국어</a>
  <a href="readme_i18n/README_de_DE.md">Deutsch</a>
  <a href="readme_i18n/README_nl_NL.md">Nederlands</a>
  <a href="readme_i18n/README_tr_TR.md">Türkçe</a>
  <a href="readme_i18n/README_zh_CN.md">简体中文</a>
  <a href="readme_i18n/README_zh_TW.md">正體中文</a>
  <a href="readme_i18n/README_uk_UA.md">Українська</a>
  <a href="readme_i18n/README_ru_RU.md">Русский</a>
  <a href="readme_i18n/README_bg_BG.md">Български</a>
  <a href="readme_i18n/README_pt_BR.md">Português Brasileiro</a>
  <a href="readme_i18n/README_sv_SE.md">Svenska</a>
  <a href="readme_i18n/README_ar_JO.md">العربية</a>
  <a href="readme_i18n/README_vi_VN.md">Tiếng Việt</a>
  <a href="readme_i18n/README_th_TH.md">ภาษาไทย</a>
  <a href="readme_i18n/README_ml_IN.md">മലയാളം</a>
</p>

> [!WARNING]
> Always follow [3-2-1](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) backup plan for your precious photos and videos!

> [!NOTE]
> You can find the full documentation at https://docs.opennoodle.de/.

## Links

- [Website](https://opennoodle.de)
- [Documentation](https://docs.opennoodle.de/)
- [Installation](https://opennoodle.de/install)
- [API Documentation](https://demo.opennoodle.de/doc) — interactive Swagger UI with all endpoints including fork-specific ones. Also available on your own instance at `/doc`
- [Roadmap](https://opennoodle.de/roadmap)
- [Features](#features)

## Features

| Features                                     | Mobile | Web |
| :------------------------------------------- | ------ | --- |
| Upload and view videos and photos            | Yes    | Yes |
| Auto backup when the app is opened           | Yes    | N/A |
| Prevent duplication of assets                | Yes    | Yes |
| Selective album(s) for backup                | Yes    | N/A |
| Download photos and videos to local device   | Yes    | Yes |
| Multi-user support                           | Yes    | Yes |
| Album and Shared albums                      | Yes    | Yes |
| Scrubbable/draggable scrollbar               | Yes    | Yes |
| Support raw formats                          | Yes    | Yes |
| Metadata view (EXIF, map)                    | Yes    | Yes |
| Search by metadata, objects, faces, and CLIP | Yes    | Yes |
| Administrative functions (user management)   | No     | Yes |
| Background backup                            | Yes    | N/A |
| Virtual scroll                               | Yes    | Yes |
| OAuth support                                | Yes    | Yes |
| API Keys                                     | N/A    | Yes |
| LivePhoto/MotionPhoto backup and playback    | Yes    | Yes |
| Support 360 degree image display             | No     | Yes |
| User-defined storage structure               | Yes    | Yes |
| Public Sharing                               | Yes    | Yes |
| Archive and Favorites                        | Yes    | Yes |
| Global Map                                   | Yes    | Yes |
| Partner Sharing                              | Yes    | Yes |
| Facial recognition and clustering            | Yes    | Yes |
| Memories (x years ago, birthdays, trips)     | Yes    | Yes |
| Offline support                              | Yes    | No  |
| Read-only gallery                            | Yes    | Yes |
| Stacked Photos                               | Yes    | Yes |
| Tags                                         | No     | Yes |
| Folder View                                  | Yes    | Yes |
| **Shared Spaces**                            | Yes    | Yes |
| **Smart Search & Filters**                   | No     | Yes |
| **Search Palette (Cmd+K)**                   | No     | Yes |
| **User Groups**                              | No     | Yes |
| **Auto-Classification**                      | No     | Yes |
| **Video Duplicate Detection**                | No     | Yes |
| **Pet Detection**                            | Yes    | Yes |
| **Google Photos Import**                     | No     | Yes |
| **Image Editing & Video Trimming**           | No     | Yes |
| **S3-Compatible Storage**                    | Yes    | Yes |

## Translations

Gallery inherits upstream Immich's translations through every rebase. Fork-specific strings are translated in this repo — see the [translations guide](https://docs.opennoodle.de/developer/translations) if you'd like to help.

## Docker Images

Pre-built Docker images are published to GitHub Container Registry (GHCR) under the `open-noodle` organization.

### Available Images

| Image                                   | Description                            |
| :-------------------------------------- | :------------------------------------- |
| `ghcr.io/open-noodle/gallery-server`    | Server + web UI + CLI (all-in-one)     |
| `ghcr.io/open-noodle/gallery-ml`        | Machine learning service (CPU)         |
| `ghcr.io/open-noodle/gallery-ml:*-cuda` | Machine learning service (NVIDIA CUDA) |

### Tags

- **`release`** / **`release-cuda`** — most recent published build (like upstream's `release` tag)
- **`v5`** — floats to the latest v5.x.x release (set `IMMICH_VERSION=v5` to auto-update within major version)
- **`v5.0.0`** — pinned version using [semantic versioning](https://semver.org/)

### Publishing

Gallery maintainers ship releases via manually-triggered GitHub Actions workflows — the full two-phase (mobile + server) flow and the server-only fast path are documented in [CONTRIBUTING.md](CONTRIBUTING.md#releases).

## Contributing

Gallery is a community fork and contributions are welcome — bug fixes, features, docs, translations. Come say hi on [Discord](https://discord.gg/cxBfbuxyG4) if you want to chat about an idea before diving in.

### Setting Up a Dev Environment

The repo is a `pnpm` workspace monorepo — server (NestJS), web (SvelteKit), mobile (Flutter), machine-learning (Python), and a few supporting packages. The dev stack runs in Docker Compose with live reload for the server and web.

**Prerequisites:** Docker, Docker Compose, Node.js 22+, and [pnpm](https://pnpm.io/installation).

1. **Fork and clone the repo**

   ```bash
   git clone https://github.com/<your-username>/gallery.git
   cd gallery
   ```

2. **Copy the example env file**

   ```bash
   cp docker/example.env docker/.env
   ```

   The defaults work out of the box for local development. Adjust `UPLOAD_LOCATION` and `DB_DATA_LOCATION` if you want to store data somewhere other than the repo directory.

3. **Install dependencies**

   ```bash
   pnpm install
   ```

   This installs deps for every workspace package (server, web, cli, sdk, e2e).

4. **Start the dev stack**

   ```bash
   mise dev
   ```

   This brings up Postgres, Redis, the ML service, the server (with hot reload), and the web UI on http://localhost:2283. The first run downloads ML models and builds containers, so give it a few minutes. Stop it with `mise dev-down`.

### Running Tests and Checks Before You Push

```bash
# Server
cd server && pnpm test          # unit tests
cd server && pnpm check         # TypeScript type check

# Web
cd web && pnpm test             # unit tests
cd web && pnpm check            # svelte-check + tsc

# Translation files, from the repo root
pnpm format                     # prettier --check i18n/
pnpm format:fix                 # prettier --write i18n/
```

CI runs lint, type checks, unit tests, and e2e tests on every PR. If you're touching server controllers or repositories, regenerate the OpenAPI clients and SQL query files:

```bash
mise open-api                   # regenerates TS SDK + Dart client
mise sql                        # regenerates SQL query docs (needs DB running)
```

`mise tasks` lists everything else available.

### Opening a Pull Request

- Branch off `main` and keep PRs focused on one change.
- Follow [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages (`feat:`, `fix:`, `docs:`, `chore:`, etc.) — the release workflow uses them to compute version bumps.
- Include a short description of what changed and why, plus screenshots or screen recordings for UI work.
- Make sure CI is green before requesting review.

## How Gallery is Built

Gallery is developed with heavy assistance from AI coding tools (Claude Code and Codex), with humans leading the ideas, testing, and debugging. We say so openly because it shaped how the project was built.

What we'd rather be judged on is the result. There's a [live demo](https://demo.opennoodle.de) you can click through without installing anything, unit and e2e suites run on every pull request, and all of it is open source — read the code and decide for yourself.

## Acknowledgements

Gallery would not exist without [Immich](https://github.com/immich-app/immich), largely written by hand, and the work of everyone who built it. We rebase onto every upstream release, so the foundation Gallery stands on keeps coming from that project.

See [AGENTS.md](AGENTS.md) for a deeper tour of the codebase architecture and common commands.
