# Retry unfinished Takeout metadata

Issue: https://github.com/open-noodle/gallery/issues/1247

An upload and its subsequent metadata update are separate requests. Previously,
when the upload succeeded but the metadata request failed, retrying the import
recognized the uploaded photo as a duplicate and skipped the unfinished write.

The uploader now records a pending marker before updating a newly created asset's
metadata. Both duplicate paths (checksum preflight and the upload response) retry
metadata only when that asset has a pending marker. A successful update removes
the marker; another failure keeps it and reports an item error with the known
asset id. The preflight metadata write runs outside the duplicate-check catch,
so its failure cannot fall through into another upload.

Markers live in localStorage, scoped by API base URL, authenticated user id and
asset id. They survive rescanning the export or reopening the importer. They
contain only a pending flag, no sidecar descriptions, coordinates or file bytes.
`takeoutMetadataManager` owns the journal and its memory fallback. It is a
singleton class in `web/src/lib/gallery/managers/*.svelte.ts`: the root layering
rule requires new fork code under `gallery/`, so the manager mirrors the web's
manager convention there rather than adding an upstream file.
If browser storage is blocked or full, a memory fallback supports retries within
the current page. The retry uses the selected file's current sidecar and current
import options, including disabled description/archive options. A retry without
a sidecar leaves the marker intact for a subsequent retry with metadata. Upload-time
favorite handling is unchanged.

Ordinary pre-existing duplicates have no marker and retain their metadata. A
completed import removes its marker so a later import cannot overwrite manual
edits. File bytes still count as skipped on a successful duplicate retry; failed
metadata remains an error and is excluded from album creation until the next
successful run. No new automatic retry loop or UI is introduced.

This cannot recover a lost upload response before the client learns the asset id,
or pending work from imports performed before this change. Markers are local to
the browser profile. It changes no server API, authorization or mobile behavior;
older Gallery servers and stock Immich use the existing asset update endpoint.
Old app/new server behavior is unchanged; new web/old server uses the same
existing requests, and stock Immich clients see no change. The uploader is
already a fork-owned file, and the new metadata helper, manager and tests live
in the Gallery namespace, so Immich-owned files gain no divergence.

Regression tests use `#test/unit/fixtures.ts` and its `api` fixture to exercise
real SDK requests from the uploader; only XHR upload and worker hashing are
mocked. They cover:
success followed by metadata failure, retry through each duplicate path,
repeated failure, marker cleanup, existing duplicates, changed import options,
user/server isolation, browser storage recovery, and an upload failure before an
asset id exists.
