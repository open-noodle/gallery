# Brainstorm: Google Photos & Apple Photos Import into Immich

## Context

Immich currently supports photo import via: (1) direct upload API, (2) CLI bulk upload, and (3) external library scanning of mounted folders. For Google Photos, the community tool `immich-go` exists but is third-party. There is no built-in, first-class import experience for the two largest photo ecosystems: Google Photos and Apple Photos. This brainstorm explores what native support could look like.

---

## What Users Have Today (Export Formats)

### Google Photos (via Google Takeout)

- Folder structure: `Takeout/Google Photos/<Album Name>/`
- Media files alongside `.json` sidecar files (one per photo/video)
- JSON contains: `photoTakenTime`, `geoData` (lat/lng), `description`, `title`, `creationTime`, `favorited`, `archived`
- Gotchas: filenames can be truncated, edited versions included separately, live photos split into still + video, duplicate files across albums

### Apple Photos (via export or library access)

- **Export from Photos.app**: Folder of media files, optional "IPTC as XMP" sidecars, subfolder-per-album structure
- **Photos Library package** (`~/Pictures/Photos Library.photoslibrary/`): SQLite DB (`Photos.sqlite`) + organized originals/derivatives in `Masters/` and `resources/`
- **osxphotos** (community tool): Can export Apple Photos library with metadata as JSON/XMP sidecars, preserving albums, favorites, keywords, locations, descriptions, people tags

---

## Design Options

### Option A: Enhanced CLI Import Commands

Add `immich upload --from google-takeout <path>` and `immich upload --from apple-photos <path>` to the existing CLI.

**How it works:**

1. User exports from Google Takeout or Apple Photos (or uses osxphotos)
2. CLI parses the export structure, reads JSON/XMP sidecars
3. Uploads via existing API with metadata populated from sidecars
4. Auto-creates albums from folder structure
5. Maps favorites, descriptions, GPS, dates

**Pros:** Leverages existing CLI infrastructure, no server changes, works with any Immich instance
**Cons:** Requires CLI installation, no progress UI in web app, large exports can be slow over network

**Key files to modify:**

- `cli/src/commands/asset.ts` — add `--from` flag and parser modules
- New: `cli/src/importers/google-takeout.ts`, `cli/src/importers/apple-photos.ts`

---

### Option B: Server-Side Import Job (Mount + Scan)

Add a new "Import from Service" feature in the server that understands Google Takeout and Apple Photos export formats.

**How it works:**

1. User mounts their export folder (e.g., via Docker volume)
2. In web UI: "Import" > "Google Photos Takeout" > select path
3. Server scans the folder, parses JSON sidecars, creates assets with full metadata
4. Runs as a background job with progress tracking in UI
5. Albums auto-created from folder names

**Implementation approach:**

- Extend the existing Library scanning infrastructure (`library.service.ts`)
- Add a new import source type alongside "External Library"
- New metadata parser that reads Google Takeout JSON / Apple Photos XMP into the EXIF pipeline
- The key gap: current sidecar support is XMP-only; would need JSON sidecar parsing in `metadata.service.ts`

**Pros:** Full UI experience with progress, leverages existing job queue (BullMQ), works with external library file watching
**Cons:** Requires mounted volume, more server complexity, tightly coupled to export formats that change

**Key files to modify:**

- `server/src/services/metadata.service.ts` — add JSON sidecar parsing alongside XMP
- `server/src/services/library.service.ts` — add import-source-aware scanning
- `server/src/dtos/library.dto.ts` — add import source type
- `web/` — new import wizard UI

---

### Option C: OAuth-Connected Direct Import (Google Photos API)

Connect to Google Photos API directly and pull photos/videos without requiring a Takeout export.

**How it works:**

1. User authenticates with Google OAuth in Immich web UI
2. Immich server calls Google Photos API to list albums and media items
3. Downloads originals + metadata directly
4. Creates assets with full metadata preservation
5. Supports incremental sync (only new photos since last import)

**Pros:** Best UX (no manual export), incremental sync possible, album structure preserved natively
**Cons:** Google Photos API has severe limitations (no original quality download for some formats, rate limits, API may be deprecated), OAuth complexity, not possible for Apple Photos (no public API), requires internet on server

**Note:** Apple has no public Photos API, so this approach only works for Google. Apple would still need export-based import.

---

### Option D: Hybrid — Smart Sidecar Support + Import Wizard

Rather than building format-specific importers, make Immich's existing infrastructure smarter about non-XMP sidecars and add a guided import flow.

**How it works:**

1. **Enhance sidecar support**: Teach metadata extraction to read `.json` sidecars (Google Takeout format) in addition to `.xmp`
2. **Add import wizard in web UI**: Guided flow that asks "Where are you importing from?" and provides format-specific instructions
3. **Smart album detection**: Parse folder structures to auto-create albums
4. **Duplicate handling**: Enhanced dedup for Takeout's duplicate-across-albums issue

**What changes:**

- `metadata.service.ts`: Add JSON sidecar discovery and parsing (look for `filename.json` alongside `filename.jpg`)
- `library.service.ts`: Add album-from-folder creation during library scan
- Web UI: Import wizard component with instructions per source

**Pros:** Minimal new infrastructure, leverages existing library scanning, extensible to other formats
**Cons:** Still requires manual export, less polished than dedicated importer

---

## Recommended Approach

**Start with Option D (Smart Sidecars + Wizard), then layer on Option A (CLI commands).**

### Phase 1: JSON Sidecar Support

- Teach `metadata.service.ts` to discover and parse `.json` sidecars alongside media files
- Map Google Takeout JSON fields → EXIF fields (dates, GPS, description, favorites)
- This alone unlocks Google Takeout import via existing external library scanning

### Phase 2: Import Wizard UI

- Add web UI flow: Settings > Import > choose source > instructions + path config
- Auto-album creation from folder names during library scan
- Progress tracking via existing job infrastructure

### Phase 3: CLI Import Commands

- `immich upload --from google-takeout ./Takeout/`
- `immich upload --from apple-photos ./Export/`
- Handles format quirks (truncated filenames, live photo pairing, dedup)

### Phase 4 (Optional): Google OAuth Integration

- Direct API import for users who want seamless sync
- Incremental import support

---

## Google Takeout JSON → Immich Metadata Mapping

| Google Takeout Field       | Immich Field          | Location     |
| -------------------------- | --------------------- | ------------ |
| `photoTakenTime.timestamp` | `dateTimeOriginal`    | `asset_exif` |
| `geoData.latitude`         | `latitude`            | `asset_exif` |
| `geoData.longitude`        | `longitude`           | `asset_exif` |
| `description`              | `description`         | `asset_exif` |
| `title`                    | `originalFileName`    | `asset`      |
| `favorited`                | `isFavorite`          | `asset`      |
| `archived`                 | `visibility: Archive` | `asset`      |
| Parent folder name         | Album name            | `album`      |

## Apple Photos Export → Immich Metadata Mapping

| Apple Photos Field               | Immich Field            | Source                        |
| -------------------------------- | ----------------------- | ----------------------------- |
| EXIF DateTimeOriginal            | `dateTimeOriginal`      | Embedded EXIF (already works) |
| IPTC/XMP GPS                     | `latitude`, `longitude` | XMP sidecar (already works)   |
| IPTC Keywords                    | Tags                    | XMP sidecar (already works)   |
| Folder name                      | Album name              | Folder structure              |
| Favorites (via osxphotos JSON)   | `isFavorite`            | JSON sidecar                  |
| Description (via osxphotos JSON) | `description`           | JSON sidecar                  |

**Key insight:** Apple Photos exports with XMP sidecars already work well with Immich's existing library scanning. The gap is mainly for favorites, albums, and descriptions which need JSON sidecar support or osxphotos integration.

---

## Key Technical Considerations

1. **Google Takeout filename truncation**: Filenames over 47 chars get truncated in Takeout; the JSON sidecar contains the real title. Need matching logic that handles this.
2. **Live photos**: Google splits into `.jpg` + `.mp4`; need to pair them using `livePhotoVideoId`. Apple exports may or may not preserve the pairing.
3. **Duplicates across albums**: Same photo in multiple Google albums = multiple copies in Takeout. Should detect via checksum and add to multiple albums without re-uploading.
4. **Edited versions**: Google includes both original and edited. Could use Immich's stack feature to group them.
5. **Scale**: Takeout exports can be 100K+ files. Batch processing, progress tracking, and resumability are essential.
