# Asset versions (design, 2026-11-07)

The files of one shot are **one photo**: the camera's JPEG or HEIC, its RAW, and the edits exported from it. One of
them is the photo and **keeps its id for good**, with everything that hangs on it (albums, favourites, comments,
people, shared links). The others are its **versions**, hidden behind it and listed in its Versions section. The
photo's **picture is its newest edit**, rendered onto it through Immich's edit pipeline, so a new edit changes what the
photo looks like and nothing else. Once the admin enables the feature, Gallery does all of this itself: it finds the
files of a shot by their names and capture times, and the files' metadata says what each file is.

**Nothing is arranged by hand** (decided 2026-11-10). There are no suggestions to accept, no per-user switches, no
"add a version", no "show this one" and no "make it a separate photo": the effort goes into recognising the same shot
correctly instead of into controls for correcting it. The only way back is the global one: switching versions off and
undoing them all ([Undoing versions](#undoing-versions)), or leaving Gallery
([Switching back](#switching-back-rule-3)). Files are therefore combined only on unambiguous evidence, and edits
are a second opt-in.

**Nothing is moved** (decided 2026-11-10). An earlier build made the newest edit the photo and moved albums,
favourites and comments onto it each time; that needed a list of everything that can hang on a photo, kept current
for ever. Now the photo is chosen once, as the file that already has the most attached to it, and a file goes behind
it only when the photo already has everything that file has.

Status of this first version: the model, automatic detection (RAW with its camera file; exported edits with XMP
lineage), the photo's picture from its newest edit, listing, previews and download for everyone who sees the photo,
the decisions in the log, admin settings, the Versions job, the revert path, undoing versions, web UI. Not
yet: the app's Versions list (the next change), phone edits as versions, C2PA lineage, face boxes that follow an
edit's crop (see [Later](#later)).

## Why not stacks

Stacks group separate photos: each member keeps its own albums, favourites, faces, comments, Space links and sync rows
on every member's phone, and the stack shows one of them on top. A RAW+JPEG pair or a Lightroom export is not a second
photo, it is the same shot. With stacks a Space member's phone shows both frames of a pair, Space cards show the NEF,
albums need stack collapse, the RAW gets favourited or added to an album on its own, and an edit put on top of a stack
does not take the original's albums, favourites, comments or Space links with it. A library with 9 369 RAW+JPEG
stacks (the requester's) is the concrete case. Versions are one photo with one id: everything hangs on it, a new edit
only changes its picture, and the versions never appear anywhere on their own.

## Model

**A version is a hidden asset linked to its photo**, the pattern of a live photo's motion part
(`visibility = hidden`, reached through its photo). Upload, metadata extraction, checksums, S3, thumbnails, download,
library scans and the phone's backup dedupe stay upstream's; upstream already filters hidden assets out of the
timeline, search, map, memories, duplicates, Space sync and the ML jobs.

**The photo's picture is an "edited look"**, the mechanism Immich has for its editor and Gallery already reuses for
colour adjustments (`asset_image_adjust`): the photo keeps its own file and checksum, `asset.isEdited` is set, and its
edited thumbnail, preview and full-size image are what every client shows and downloads (web, app, stock Immich apps,
shared links), with no client change. Here those files are rendered from the newest edit's file instead of from the
photo's own.

One fork table (rule 1; its foreign keys are in `gallery-upstream-fks.json`), with a row for every file of a combined
shot, decided 2026-11-13 (three tables before: the look and what was read had their own):

| Column | What |
|---|---|
| `versionAssetId` | PK, cascade: the file the row is about |
| `assetId` | the base photo of its shot, **SET NULL** when it is deleted (the cleanup then deletes the orphaned versions); on the base photo's own row, the file itself |
| `role` | `base_photo` (the file shown in the timeline; it keeps its id for good) or `version` (a hidden file behind it). Every question about "the files behind a photo" asks for `role = 'version'` |
| `kind`, `source` | what the file is (`raw`, `original`: the camera's own JPEG/HEIC, `edit`) and what made it (camera, lightroom, darktable, ...). On the base photo's row they are what the photo itself is: the picture choice and duplicate detection read them |
| `rule` | how a version was found for its shot (`raw:name`, `edit:time`, ...); `photo` on the base photo's row |
| `priorVisibility`, `wasStacked` | how a version was shown before, and whether it shared a stack with its base photo: for switching back |
| `read` | `jsonb`: what was read from the file with ExifTool (`FileRead`: status, parser version, when, and the signature the rules take: make, model, serial, shot counter, capture second and fraction, offset, the files an edit names as its source and whether a person's instruction named them, software, edit, kept apart, RAW, burst). Kept so that the files of a combined shot are not read again by every job that finds them. No query filters on it: files are found on Immich's own columns |
| `lookSourceAssetId`, `lookSourceModifiedAt`, `lookUpdatedAt` | base photo only: the file its picture was last rendered from (**SET NULL** when that file is deleted), that file's date then (an export written again is a new picture), and when it was rendered. `lookUpdatedAt` set means the photo shows another file's picture, whatever happened to that file since |
| `lookQueuedAt` | base photo only: when the cleanup last queued its render; any render that records or resets the look clears it. The cleanup skips a photo queued in the last hour, so a render that keeps failing is tried once an hour at most |
| `syncedAt`, `cleanupQueuedAt`, `createdAt` | a version's follow-up, its deletion after its base photo's, its creation |

Checks: the role is one of the two; a row is the base photo's exactly when it points at itself; only a base photo has
a look. The base photo's row is made by the first pairing, and lives while files are behind it **or** its picture
comes from another file: the reset of that picture (the edit job finding nothing to show, under the photo's lock)
removes it, and the cleanup removes one that slipped past. A file that is not combined has no row; the Versions job's
"Missing" run goes by a stamp on the fork's per-asset job table instead (`asset_job_status_gallery.versionsReadAt`,
`versionsParserVersion`: when the file was last read, by which parser).

**Which file is the photo** (`planShot`), chosen once, when a shot is first combined:

1. A file that already has others behind it is the photo, and stays it whatever arrives later.
2. Otherwise the file with the most attached to it: albums, favourites, shared links, Space links and Space-album
   contributions, comments and likes, edits made in Gallery's own editor. What people organised keeps pointing at
   the same id, so nothing has to move.
3. With nothing to tell them apart, the regular case: the shot's camera JPEG/HEIC; then the newest edit; then
   another camera file before a RAW or TIFF; then the one added to Gallery first (a folder group can hold several of
   each).

A caption or a rating the user wrote in Gallery (Immich marks those fields as locked) counts by its value: the same
on both files is no difference. Tags and memories do not count: tags come from the keywords inside the file (nearly
every Lightroom export has some its original lacks), and memories are made by Gallery itself.

**A file goes behind the photo** (`AssetVersionRepository.pair`, one transaction, advisory lock per asset in id
order, state re-checked under `FOR UPDATE`) **only when the photo already has everything that file has**. Its own
entries are then duplicates and are removed (a hidden file that kept them would still show in shared albums and
through shared links); its tags stay on it and are copied to the photo, then and again on every detection run (a
metadata read of the photo rebuilds its tags from its own file and drops the copies; detection follows every such
read, decided 2026-11-10); an album or Space cover it was becomes the photo; it leaves
its stack (only members still shown count: a stack left with fewer than two is dissolved, never headed by a trashed or
hidden member; a burst stack keeps its other members); it is hidden. A file with something of its own (an album the
photo is not in, a comment, a shared link without the photo, a face someone drew or named on it by hand) is **not combined**
and stays a separate photo, as today. Comments and likes, edits made in Gallery's editor, and faces drawn by hand or given their person by hand
(`face_identity_face.source = 'manual'`; decided 2026-11-13, after astra-15 and astra-16: on a hidden file such a face would be on no visible photo, and Immich's People
list could lose a person who is on that one photo only) can never be "on the photo too", so a file that has them is
either the photo or stays apart. Faces the face job found are not counted: every file of a shot has its own. `VERSION_TABLE_POLICY` gives every table that points at an asset one of
these answers, and `asset-version-tables.spec.ts` fails when Immich or Gallery adds such a table without one.

Afterwards the visibility-transition side effects run (`applyVisibilityTransitionSideEffects`), so Space members'
phones drop the hidden file's rows; `asset_version.syncedAt` records that this follow-up completed, and the cleanup
replays it for pairings where it did not (a crash or a failed emit after the commit; the purge is idempotent, and of
two runs one does the work). The owner is sent `on_asset_hidden` (the app syncs on it). An open web timeline does not
drop a just-hidden file until it reloads: upstream's web timeline has no live event for an asset becoming hidden.

**Whose picture the photo shows** (`chooseLook`): the newest edit of the shot, the file written last
(`asset.fileModifiedAt`; ties by id), whether it arrived first or last. When that is the photo's own file, or the
shot has no edit, the photo shows its own file; a RAW that is the photo shows its camera JPEG/HEIC when it has one
behind it. Known limit: two edits of one shot copied in together by a tool that resets file times can end up in the
wrong order.

**How the picture gets there** (`asset-version-look.ts`): one hook in `MediaService.generateEditedThumbnails`, the
function both Immich's edit job and its thumbnail job go through, next to the colour adjustment's. When a look
applies it has the job decode the version's file in place of the photo's own; the outputs are the photo's edited files
as for any edit, and the job updates the thumbhash and tells clients (`AssetEditReadyV2`). **Once the picture's files are stored and registered** (`published`, which the two jobs
call after their `syncFiles`), and not before, the look is recorded on the base photo's row with the source's date,
the photo is marked edited and given the picture's size. The record therefore says what the edited files hold: a
render or an upload that fails leaves it as it was, and of two renders at once (the editor queue runs two jobs) it
holds the one that wrote last. A reset that finds, under the photo's lock, that a pairing has given the photo an edit
to show after all (`clearLook` answers `refused`) renders that edit instead of removing the edited files. Because every path that writes or removes edited files
goes through that function, regenerating thumbnails cannot wipe a look. When no look applies any more it removes the
record, and the job removes the edited files as it does after the last crop is undone. The edit job is queued
whenever the record differs from what the picture should be (another file, or the same file with another date: an
export written again over itself): when detection looks at the shot; after each edit job that did not report failure
(`JobSuccess`), for an edit that went behind the photo while it was being rendered or an older render that wrote
last; and by the cleanup, which also runs while versions are off, for a shown edit that was deleted or rewritten. A
render that fails is not chased from the job itself (it would be queued again for ever): the cleanup finds every
photo whose picture is not the one it should be (`getOutdatedLooks`: `chooseLook`'s answer in SQL, ties broken by
id, compared with what is recorded; a recorded picture whose edited preview is missing, as after a reset that removed
the files while a new render finished; a first render that never succeeded), a page at a time, and queues it again
at most once an hour (`lookQueuedAt`). Photos changed in Gallery's own editor are left out: their edits make the
picture. The next detection of the shot and the Versions job also try again.

**Gallery's own editor** crops, rotates and mirrors the photo's own file: its crop tool shows that file
(`edited: false`), and the edit job applies the edits to it. On a photo that shows an edit made elsewhere the user
would be editing another picture than the one on screen, and saving would replace the edit they see, so
`AssetService.editAsset` refuses it (`requireOwnPicture`, one call; decided 2026-11-10, after a review).
Removing edits stays allowed. A crop made before the photo had an edit to show wins while it exists, and the look
comes back when it is removed. A colour adjustment has no geometry and applies on top of the look. Face and OCR boxes are detected on the photo's own file, so they can sit off when the
shown edit is cropped differently.

There is no reverse step. Nothing makes a version a photo of its own again, and the photo of a shot never changes.

**Lifecycle**: a version follows its photo without a state of its own. Trashing or restoring the photo needs nothing
(the version is hidden either way, and only reachable through the photo). **Deleting the photo deletes everything
behind it**: the FK sets `asset_version.assetId` to null, and the cleanup job (`AssetVersionCleanup`, deduplicated:
one waiting at a time)
queues `AssetDelete` for those versions, deleting the file only for uploads, never an external library's file, and
stamps `cleanupQueuedAt` so it is not queued again within the hour. The cleanup is queued after every `AssetDelete`
event, after the jobs that delete without one (a library's file watcher, library deletion, the trash sweep), at
start-up, and by the Versions job, whether versions are enabled or not; the nightly trash sweep (`AssetDeleteCheck`)
makes it run at least daily. It scans again until it finds no new orphans (a deletion while it runs cannot queue a
second one), and replays every pending follow-up a page at a time. Hidden assets get their thumbnails like any
other when they are versions (one hook in `MediaService`), so a version paired before its first thumbnail job still
gets one; the thumbnail queue's own Missing/All skip hidden assets, so the Versions job queues thumbnails for versions
missing a thumbnail or a preview (every version with All).

**Duplicates** (decided 2026-11-10): resolving a duplicate group deletes the discarded photos, and so the files
behind them. A camera file and its RAW are one unit, and the user who discards it means both. A shot that includes an
edit is left out of Immich's duplicate detection instead (`asset-version-duplicates.ts`, one wrap around the search
result in `DuplicateService.handleSearchDuplicates`): its photo neither looks for duplicates nor is found as one, and
leaves the group it was in when an edit joins the shot. Otherwise a look-alike, such as an edit Gallery did not
recognise, which can be the larger file and so the one Immich suggests keeping, could take the recognised edit and
the originals down with one click.

**Decisions**: when a file goes behind a photo it is logged once, and its row keeps how it was found (`rule`). When a
file has a candidate of the same shot and is left apart, that is logged with the reason and the other file, each time
a job decides so (decided 2026-11-13: a file that is not combined has no row to keep it). A file with nothing to
combine with is not logged, so the log is not filled with them; nor are files that only look close and are different
shots (burst frames, files of other names taken at the same time).

## Detection

The rules were made simpler on 2026-11-11 (reviewed twice): files are found
by **name and time**, and what is read from inside a file says what it is and gives the reasons to say no. It is
never what finds a pair. Phones and cameras follow the same steps. The earlier rules (a ±2 s window of up to 50
files, each read; identity levels I1 to I3 and lineage levels E1 to E3) are in this file's history.

One job runs per file: after its metadata was read (`AssetMetadataExtracted`), or from the Versions job (Missing:
files never read for versions; All: every image). The job (`AssetVersionService.handleDetect`) is seven steps:

| # | Step | Where |
| --- | --- | --- |
| 1 | Should we look at all: versions on, an image, not in the trash | `shouldLook` (pure) |
| 2 | Read the job's file with ExifTool, once (kept only on the row of a file that is combined) | `readFiles` |
| 3 | Find the candidates, from the database alone | `findCandidates` |
| 4 | Read the candidates not read yet (the few that were found) | `readCandidates` |
| 5 | Link: which files belong together, which is the photo, what goes behind it, what is left apart and why; then search around the files about to be paired and link again | `linkFile` (pure), `findAroundPairings` |
| 6 | Apply: `pair` under its lock, with the state as it is then; each pairing is a row, every decision is logged | `apply` |
| 7 | Finish: tell the apps, copy tags, leave duplicates, choose the picture | `finish` |

**Names** (`asset-version-names.ts`, pure). `shotBase` is the name a device gave a shot: the file name without its
extension and, for a name of a Pixel's shape (`PXL_<date>_<time>`, in any case), without the labels that phone puts
after it (`.RAW-01.COVER`, `.NIGHT`, `.PORTRAIT`: a list of the phone's own labels, so what a person or a program
added after them, `.COVER_1`, `.COVER_HDR` or `.ORIGINAL-HDR`, stays in the name, and the two files of a shot with
a label the list does not know are left as two photos), in lower case. In a name a person gave,
a dot is part of the name. `editSourceBase` strips what marks an edit (`-edit`, `_edited`, `-Edit-2`, an
iPhone's `IMG_E…`; not `_result`, any program's output, nor `~2`, a copy as often as an edit) and gives the name of the shot it was made from. Nothing else is loosened: a number that tells
frames apart (`DSC_9425`, `_BURST1`) and a copy mark (` (1)`, `Copy of`) stay part of the name, so two frames never
look like one shot and a copy is not taken for the camera's file. The spec runs the function over the names 28
makers and phones write (Nikon, Canon, Sony, Fujifilm, Olympus, Panasonic, Pentax, Leica, Ricoh, Sigma, Hasselblad,
DJI, GoPro, iPhone, Samsung, Xiaomi, Huawei, OnePlus, Pixel) and over the name shapes of one real library.

**What a file is** (`isEdit` in `asset-version-signature.ts`, kept as the row's `kind`, the base photo's too, so that
the two SQL questions "is this an edit", the picture and the duplicates, give the same answer): a RAW by its type; an
edit when its name carries an edit mark or the file says so inside (it names the file it was made from, points at
one by id, or its History records a `derived` or `converted` step); otherwise the camera's own file. The software
tag alone says nothing: every camera writes one.

**Finding candidates** (step 3) uses the capture time on the camera's clock that Immich stores for every file
(`asset.localDateTime`, indexed), so a file is found whether versions have read it or not:

- **by name**: the owner's files in the same library whose name contains a base name of the job's file, taken within
  20 seconds: twice the 10 seconds the rules allow between two files of a shot (`NAME_WINDOW_SECONDS`), so that a
  file found comes with the other files it could go with too, and "the only match, both ways" is decided on all of
  them (decided 2026-11-13, after astra-15: a JPEG nine seconds after one RAW and nine before another of the same
  name went with whichever RAW's job ran first). A shot of an iPhone's shape (`IMG_1234`) is also searched by its
  edited copy's name (`IMG_E1234`), which does not contain its own, so the two find each other in either order of
  arrival. And before a pairing is made, the files of each pairing are searched around in the same way, and the
  linking done again with what that finds (`findAroundPairings`, at most three rounds): an edit can find a RAW whose
  second JPEG of the same name is beyond the edit's own search. A search cut off, or still finding files after three
  rounds, decides nothing. A camera uses a name again only after 10,000 shots. Read with a limit of 50
  (`NAME_SEARCH_LIMIT`), which only an odd name reaches (a file called `a.jpg` in a burst): a search that is cut
  off holds an arbitrary part of the files, so the job then decides nothing.
- **by time**: those taken at exactly the same time, to the millisecond: an edit keeps its capture time, whatever
  it is called. Read with a limit of 10 (`SAME_TIME_LIMIT`): that many files at one time is a camera whose clock was
  never set, and then the time finds nothing. The search by name is not affected.
- **by folder**: those stored in the same folder under the same name, only the extension differing
  (`getCandidatesInFolder`, `storedPlace`), whenever they were taken: the time Immich stores for a file with no
  capture time is the file's date, so a scan and its export are not found by time. The stored name, literally and in
  its case, not the original one: within a folder it is unique, on disk and in S3 alike, while an upload is stored
  under its id in a folder shared with unrelated files, and the storage template stores a second `scan.jpg` of a day
  as `scan+1.jpg`. Matched through the original name first, which Immich's trigram index on file names serves (under
  a millisecond on a library of 114,000 files, 2026-11-14), then on the stored path exactly. The search around files
  about to be paired searches their folders too.
- **what is combined already**: the photo of every candidate that is behind one, and the other files behind it. A
  Pixel's RAW and JPEG differ in their fraction of a second, so an export at the RAW's exact time finds the hidden
  RAW and not the photo. A photo that is in the trash comes too: its shot then waits for it, and new edits of the
  shot do not become a photo of their own.

A file whose own job has not run is read by the job that finds it (step 4): ExifTool runs on the job's file and on
the candidates, never on everything around. On one server, files within ±2 s of a photo number more than 50 for 557
photos; files of the same name within 10 s are one or two.

**Linking** (step 5, `linkFile` in `asset-version-rules.ts`, pure: the job's file, the candidates with what was read
from each, and what hangs on each go in; the decisions come out):

- **A RAW and the camera's own file** are one shot when they have the same `shotBase` and were taken within 10
  seconds, unique both ways (a RAW with two camera files, or a camera file with two RAWs, is left apart).
- **The folder rule** (decided 2026-11-14, for film scans and files that lost their capture time;
  `sameFolderShot`, `folderGroupOf`): files stored side by side under one name are one shot, every one of them, also
  RAWs only (a NEF and its DNG) or camera files only (a JPEG and a HEIC); the one-to-one rule does not apply, since a
  name cannot belong to two shots in one folder. Capture time only says no: both have one and they are more than 10
  seconds apart (a counter that came round again); one or none having one is no contradiction. Every other veto and
  contradiction counts as for any pair. The group's RAW and camera file are the first added of each (`addedAtMs`,
  then id), so every member finds the same shot, as long as no two of them contradict each other (the accepted
  `frame.NEF` / `.DNG` / `.JPG` case below is the exception); the photo is chosen as for any shot (`planShot`, "Which file is the
  photo" above). An edit goes with its source by `folder` too: stored beside it under the same name
  (an export saved over its source's name), with the same time rule. Found this way, a file's rule is `…:folder`.
  Not checked: every pair of a group against each other for time (a NEF at 12:00:00, a DNG without a time and a JPEG
  at 12:01:00 are one shot); such a folder is far less likely than the cases the rule is for, and an instruction keeps
  a file apart.
- **A TIFF that is not an edit is a master** (`MASTER_EXTENSIONS` in `asset-version-signature.ts`): it counts as the
  shot's RAW, so a JPEG or HEIC of it is the photo and the TIFF goes behind it. Immich's own RAW list is unchanged;
  an edited TIFF (`DSC_0201-Edit.tif`, or one that names its source inside) stays an edit.
- **An edit** goes with a RAW or a camera file by `name` (its `editSourceBase`, or its own `shotBase`, is that
  file's; both taken within 10 seconds) or by `time` (the edit names that file inside as the one it was made from,
  and both were taken in the same second and the same fraction, to the millisecond; `.60` and `.600000` agree, and a
  time without a fraction is at `.0`). A RAW and its JPEG are one shot for an edit, not two sources; an
  edit that fits two shots is left apart. With edits switched off, edits are left alone.
- **The time alone never makes a pair.** A camera takes several shots in one second, and the frame an edit was
  made from may not be in Gallery while its neighbour is. The time only finds the file an edit names. A file that
  records no capture time (`DateTimeOriginal`) is within nothing, except under the folder rule: `CreateDate` is not
  read in its place, since for
  a graphic or a scan it is when the file was saved. And the time finds nothing for a job when a file at that same
  time could not be read: it may be the one the edit was made from.
- **A file that records its own name says nothing.** Some programs write the name a camera's JPEG already has into
  it (`PreservedFileName`); such a name is left out, and the file is not taken for an edit by it. Only the very same
  name: an export saved under its source's name (`DSC_9425.jpg` from `DSC_9425.NEF` or `DSC_9425.JPG`) keeps it.
- **What an edit says inside comes before its name.** An edit that names a source (`sourceFileNames`: every one of
  `PreservedFileName`, `RawFileName` and `DerivedFrom` that is there, since after a rename in Lightroom the first
  is the camera's name for the file and the second the new one) goes only with a file of one of those names, also
  when its own name is that of another file.
- **Two instructions let a person decide** (`asset-version-signature.ts`, `instructionsOf`; read from the IPTC
  Instructions field, XMP `photoshop:Instructions` and IPTC `SpecialInstructions`, of the file and of its XMP sidecar,
  one per line or separated by `;`, in any case). `noodle-gallery:keep-apart` sets `keepApart`, which says no to every
  pair.
  `noodle-gallery:version-of=<file name>` makes the file an edit whose only source name is that one, whatever an editor
  recorded (`sourceFromInstruction` records that it did): it then goes with that file like any edit that names its
  source, which needs the same capture time (a name alone is used again by the camera). The named file may be an
  edit, which no editor's record may name: a person saying so is evidence the rules do not otherwise have. The
  marked file then goes where that edit goes, one step only (`sourcesOf`), so two files naming each other end: into
  its shot, or behind the photo it is behind; and when Gallery has neither its RAW nor its camera file, the shot
  hangs on that edit, which becomes the photo. A RAW or camera file of it that arrives later goes behind that edit.
  Known limit: a camera file in Gallery that the job does not find (its date not read yet) then stays apart from it. Two such instructions that name different photos set `keepApart`: the field
  has two forms and a sidecar, and a correction may reach only one. A photo that is kept apart after files
  went behind it keeps them and takes no new one (`planShot`); taking them apart is the undo's job. The Instructions field (decided 2026-11-14), because photo programs offer it
  for "how to handle this picture" and Immich does not read it: keywords would also become Immich tags, and a tag
  given in Gallery would then act as an instruction. A field of Gallery's own could be written by ExifTool with a
  configuration file and by little else. The sidecar is read too, for this field only (`readSidecarInstructions`),
  because programs write a RAW's details there; Immich never writes Instructions into a sidecar. A sidecar is found
  through Immich's own record of it (`asset_file`), so one added later needs Immich's Sidecar discovery job first.
  In an "All" run, a candidate's read kept from before the run is read again (`readCandidates`), so an instruction
  given since counts whichever job of the run comes first.
- **What says no to any pair**: another owner or library; another make, model, serial, shot counter, burst or time
  zone, where both files record it (an export seldom has all its source has); a file that is kept apart (the
  instruction, or a file marked as a merged HDR or panorama, or made from several sources; what was placed into a
  picture in an editor, `Ingredients`, is not looked at); a live
  photo; the same bytes; files that only a third brings together and that
  contradict each other; a candidate that could not be read and has the name of a file of the shot, or a name an
  edit of the shot records for its source (it takes no part, and is not forgotten, or the others would look like
  the only match).
- **What is combined stays together**: a file that is behind a photo goes with that photo whatever its name and
  time say now, keeps its decision, and its job still puts a newly arrived edit behind the same photo. An edit that
  is combined keeps its photo while edits are switched off, and though it now fits two shots: its job still restores
  the photo's tags and picture.
- **A job speaks of its own shot only.** What is stored and logged as left apart is about the files of the job's
  file's shot; the earlier rules also reported other files that happened to be read with it.
- The shot's root is the camera's file, or the RAW of a RAW-only shot; an edit only for a shot that hangs on it. `planShot` then chooses the
  photo and decides each other file, and `chooseLook` the picture, both under [Model](#model).

**The one choice that cannot be put right later** is a RAW becoming the photo with an edit behind it while the
camera's JPEG is in Gallery and was not found: before Immich has read a file's metadata, its date is the file's
date on disk (a library scan) or the one the app sent (an upload), and in a library copied without its file dates
that is not the capture time. And an export under another name finds a Pixel's RAW by its exact time and not the
JPEG, which carries the RAW's name at another fraction of the second. So when a job is about to make that choice
(`namesOfMissingCameraFile`), it looks in the same library for files, not RAW, that go by a name of the shot and
were not found for the job's own file: those taken within twenty seconds, and those whose `metadataExtractedAt` is
empty. It reads those few itself (at most ten of the second kind) and links again: their own capture time then says
whether they are of this shot. Nothing is put
off, because a shot that is put off is not come back to: with recycled camera names, the file that blocked it may be
from another year. Not covered: a JPEG that is not in Gallery at all when the RAW and the edit are combined; the RAW
then stays the photo. Moving the photo afterwards was considered and not built (a time limit, and a write path that
takes files from one photo and puts them behind another).

**Left out on purpose** (owner: a likely case that costs a condition is handled, a rare one that costs much code is
not): an edit whose time differs from its source's and whose name does not contain the base name stays a separate
photo; a second, wider search for an unmatched edit was considered and put off. A fast burst from a camera without
fractions can put 10 files on one time by itself; its RAW and JPEG pairs are still made by name.

**Order and parallel jobs.** A file's job runs after that file's own metadata is final, and it does not wait for
the other files' jobs, so the job of the file that finishes last sees the others: no arrival order leaves a pair
uncombined. The Versions queue runs one job at a time by default; two jobs that do run together both plan the same
pairing, and `pair` takes its lock on the two files, so one of them makes it. A database test runs the three jobs
of a shot at the same moment, for eight shots, and fails every time with the lock taken out.

Checked on real files under the present rules (2026-11-12, a throwaway server, 18 files of six shots): six RAW +
JPEG pairs by name (five Nikon Z50II, one Pixel 11 Pro), and five edits behind their photos by name, one of them an
older export with nothing inside to say it is an edit, which the earlier rules left apart. A file of another name
with only the camera's metadata (a glare fix) stays a photo of its own.

The checks below were made under the earlier rules; what they found about cameras and editors still holds.
Checked on real files (2026-11-07): Nikon Z50II NEF + JPEG (I1), its Lightroom Classic export with and without the
NEF in the library (E3+I1), Pixel 11 Pro DNG + JPEG 133 ms apart (I3). Checked again for names and counters
(2026-11-10): a Pixel 11 Pro writes neither serial nor counter, names both files of a shot
`PXL_<date>_<time>.RAW-01.COVER.jpg` / `.RAW-02.ORIGINAL.dng`, 57 to 209 ms apart, and in a burst the RAW of one frame
comes 192 ms after the JPEG of the frame before, so time alone cannot pair them; an Olympus E-PL1 (ORF + JPEG) and a
Canon EOS 250D write a serial and no shot counter; an iPhone 17 Pro writes neither and names its files `IMG_<4
digits>`; a Sony A7 V's own files were not available (only Lightroom exports, which carry no serial).

Checked on public samples (2026-11-10: ExifTool's sample collection, camera JPEGs of every model since 2019, and RAW
files from raw.pixls.us):

| Make | Serial and counter | Serial, no counter | Neither |
| --- | --- | --- | --- |
| Sony (31 models) | 19 (A7 III/IV/V, A6xxx, A1) | 2 | 10 (A9 III, ZV-1 line, RX100 VII, ZV-E10 II) |
| Canon (32) | 7 (R5, R6 line, R8, R50) | 22 (R10, R7, RP, R100, R5 II, R1, 90D, 250D, 850D) | 3 compacts |
| Nikon (18) | 14 (every Z and D body) | 4 Coolpix | - |
| Fujifilm (29) | 21 | 8 | - |
| Panasonic (23) | - | 23 (S5, S5 II, S1 line, GH7) | - |
| Olympus / OM System (12) | - | 12 (OM-1, OM-1 II, OM-5, E-M1 III) | - |
| Apple, Google, Samsung, Xiaomi (80) | - | - | all |

("Counter" is the camera's own: `ShutterCount` or `ImageCount`.) A RAW carries what the camera's JPEG carries (A7 V and A7 IV ARW, R10 CR3, S5 II RW2, OM-1 ORF, X-T5 RAF; iPhone 12
Pro, Galaxy S23 Ultra, Redmi Note 8T and Pixel 8 Pro DNG). Sony keeps serial and shutter count in its maker notes
(the EXIF serial only with "Write Serial Number" on), and the count stands still with the silent shutter (ExifTool
forum, its author included). Samsung often and Olympus always write no sub-second time. Adobe's `aux:ImageNumber`
differs from the maker-note shutter count in the same file for a Sony A6400 (99 against 241) and a Canon R6 II (6138
against 1304). Phone RAW names: `IMG_1361.DNG` (iPhone), `20230817_120455.dng` (Samsung), `IMG_20200715_094601.dng`
(Xiaomi), `PXL_20240415_103400204.RAW-02.ORIGINAL.dng` (Pixel). A copy of a photo made by a tool that
removes glare, or a re-export, with the name of its source inside (`PreservedFileName`, `DerivedFrom`, or the
`noodle-gallery:version-of=` instruction) goes with its photo, also when it kept the original's XMP instance id: such tools copy
the metadata whole, so a shared instance id is not read as "a copy" (decided 2026-11-13; only the same bytes are). Tag
shapes from those files, anonymised, are the fixtures of `asset-version-rules.spec.ts`. Lineage formats of other
editors (from primary sources where available): Adobe writes full xmpMM, Lightroom's RAW id is made up (so the RAW
is found by the source name the export records, not by that id); darktable writes `DerivedFrom` as a file name;
RawTherapee copies the source's XMP (a shared instance id is not read as a copy, as above); Capture One, DxO,
Affinity, Luminar, Apple and Google Photos are unverified.

## Who sees what (rule 7)

Everyone who can see the photo sees the files of its shot, previews included, and downloads them under the photo's
download rule (decided 2026-11-07: no narrower layer). Nobody changes them: the routes are read-only. They check
access to the **photo** with upstream's permissions and that the file belongs to it:

| Route | Permission on the photo |
|---|---|
| `GET /assets/{id}/versions` | `asset.read` (shared links included) |
| `GET /assets/{id}/versions/{versionId}/thumbnail` | `asset.view` (shared links included) |
| `GET /assets/{id}/versions/{versionId}/original` | `asset.download` (a shared link's `allowDownload`) |

The list holds every file of the shot, **the photo's own file included** (under the photo's id; the same two routes
serve its unedited image and its original file, which is how the original stays reachable while an edit is shown;
only for a photo that has versions: for any other photo they answer 404, or a shared link could get the unedited
image of a photo cropped in Gallery's editor, which Immich never shows to shared links),
each with its kind and whether it is the one shown: edits newest first, then the original, then the RAW. It is empty
for a photo with no versions, and for a shared link that hides metadata (the list is file names and dates; a version
downloaded through such a link is named by its id, as Immich names a thumbnail there; Immich still names the photo's
original by its file name). No new `Permission` values are
needed.

**The generic asset routes.** Immich lets owners and partners reach a hidden asset by its id (a live photo's video is
one). A version is the same shot as its photo, so it is reachable there only as its photo is (decided 2026-11-13,
after astra-15): for every permission on assets by id (`asset.read`, `.share`, `.view`, `.download`, `.update`,
`.delete`, `.copy`, `asset.edit.*`, and `assetFile.read`, `.download`, `.delete` for a version's files, checked on the
photo as read, download and delete), `versionsFollowTheirPhoto` (`src/gallery/utils/access-grants.ts`) drops a
version whose base photo the caller does not get under the same permission: once the photo is locked (without the
PIN), archived (for a partner), in the trash (for a partner), no longer in a shared link that holds the version, and
so on; and a version whose photo is gone (until the cleanup deletes it). It runs after the fork's grants for users
and after `checkSharedLinkAccess` for shared links: one wrapped call in `checkAccess`. It only takes away. One lookup
by primary key in `asset_version` (or `asset_file`) per check, split into chunks like Immich's own (rows, not a
set). The matrix "a version is reachable only as its photo is" in the same spec runs `checkAccess`
over owner without and with the PIN, partner, album and Space viewer, outsider and non-member admin × the photo in
the timeline, archived, locked and in the trash × those ten permissions, from a written truth table, and snapshots
the grid.
`test/medium/specs/gallery/asset-version.service.spec.ts` runs the real service over owner, partner, album viewer and
editor, the owner of another album holding the photo, Space viewer, editor and owner, shared link with and without
download and one that hides metadata, outsider and non-member admin × list, thumbnail, original × enabled/disabled (off: an empty list for whoever may see the photo, nothing served), from a truth table in the
spec, and snapshots the grid. The same spec covers what happens to a file going behind (duplicates removed, tags
copied, cover, stack; a file with an album, comment, favourite or shared link of its own refused, with nothing
changed), that the photo of a shot stays the photo, detection end to end (a RAW behind its camera file with edits
off; an edit behind the photo with the picture queued and nothing on the photo touched; a later edit and one arriving
late; the organised edit chosen as the photo; each pairing stored and logged once), the look (the edited flag with and
without a colour adjustment; a deleted shown edit), cleanup of uploads and of library files, the follow-up replay, a
version missing only its preview, and `down()` (inside a rolled-back transaction) with a trashed photo, a locked one
and one showing an edit. `asset-version-look.spec.ts` runs the edit job with a look: decoded from the edit's file,
written as the photo's edited files; Gallery's editor winning; the look removed. A code review by a second model, rounds
1-4, was on an earlier shape of this code (versions behind the camera file, relationships moved, manual add and
unpair); the same-id model, the look and the removal of the manual controls came after it. Another model then reviewed
this design (2026-11-10): the model held; fixed from it were the own-file route answering for photos without
versions, the look recorded before its render, an export rewritten in place, sizes on one render path and after
switching back, shots joined through a third file that contradict each other, a caption or rating written in Gallery
not counting as the file's own, and a combined file's decision being overwritten. Open from it: file dates on S3, and
the app's cache of full-size images. Decided and built from it: the editor refused on a photo that shows an edit,
tags copied again on every detection run, shots with an edit left out of duplicate detection (a RAW + JPEG unit can
still be discarded as a duplicate), and a read cut off at the row limit combining nothing (the row limit went with
the simpler rules of 2026-11-11, see [Detection](#detection)).

## Settings

`server.assetVersions` in `GalleryServerExtension` (rule 5), two switches, both off by default: `enabled` (the files
of one shot are one photo: a RAW goes behind its camera file) and `detectEdits` (exported edits are grouped too, and
the photo shows its newest edit; needs `enabled`). Edits are a second opt-in because they change what a photo looks
like, which not every library wants, and because nothing undoes it per photo. Off: detection stops (queued jobs
re-check and skip, and a pairing asks again under its lock); what was combined stays combined, its photo's picture
is kept and regenerated, and the Versions job still runs its cleanup and thumbnails. But versions are not shown
while off (decided 2026-11-12): the list is empty for whoever may see the photo, and no version's
picture or file is served, so neither client shows the section. Switching only edits off changes nothing that
exists. While versions are off they can be undone, below. `GET /server/features` reports
`assetVersions` (optional, absent on older servers). The Versions queue (`assetVersions`, concurrency 1) is on the
Jobs page.

## Version pairings (rule 6)

| | Older Gallery / stock Immich server | New server, off | New server, on |
|---|---|---|---|
| Stock Immich app, older Gallery app | as today | as today | versions disappear from the timeline (hidden); the photo shows its newest edit, as it shows any edited photo; the RAW and other files are never re-uploaded (backup sees the hidden assets' checksums); no Versions list |
| New Gallery app / web | no section (404, read as none) | no section (the list is empty) | full |
| Stock Immich server booting a Gallery DB | | | versions are hidden assets with no link until `scripts/revert-to-immich.sql` runs; the revert shows them, as their photo is now or as they were before, and stacks one under its photo if the two shared a stack before |

No sync stream, no new sync payload: clients fetch versions on demand. A newer client asks an older server and gets
404, which it reads as "no versions".

What this section and the next say about the app (its Versions list, its download, the times it shows) describes
the next change, which adds the app's part; this one has the server and the web.

Both clients list the versions, show one larger and download its file. The mobile download hands the version's
`/original` address to the app's own downloader, in its image group (`AssetVersionDownloader`): the app then shows
the progress and saves the finished file to the phone's gallery as it does for a downloaded photo, and no upstream
mobile file is touched. An offline version has no download. Not built: leaving out a file the phone already has
(it is saved a second time).

The web list is a row of the info panel's Details (decided 2026-11-11, after a look in a real browser). Each file is
a card: its label and its time with the time zone on one line, its name on the next, then its thumbnail in the
picture's own shape with the format and size, the dimensions and the download beside it. The label is the kind only
(Edit, Original, RAW). The file the photo's picture comes from has its card outlined and a "Shown" tag beside the
thumbnail: in the label, "Edit · Shown" left no room for the time and its zone on the same line. The editor that
made an edit (`source`) is not named. The zone is written short (GMT-4), and only for a time whose zone is known:
the camera's files get none when the photo records none, as in the panel (`versionZoneLabel`). The time of the camera's
own file and of the RAW is when they were taken, on the camera's clock as the panel shows the photo's, not in the
browser's time zone: the server sends an instant, and the photo's distance from UTC is applied to it
(`versionCapturedAt`). The time of an edit is when it was made: the response carries each file's written time
(`fileModifiedAt`, the time that already decides which edit is the newest), shown in the viewer's own time zone
(`versionTime`); the mobile list shows it too. An offline file says so where its download would be. A click on a
thumbnail opens the picture in a window that fills the browser's (the UI library's fixed sizes stop at 1024 px
wide). The mobile list shows the same times: a capture time on the camera's clock with its zone, worked out as the
date row of the details sheet works out the photo's (`resolveAssetDateTime`), and an edit's time on the phone's.

On the web, the mouse on a version's thumbnail shows its preview beside the info panel, over the photo
(`versionPopupBox`, decided 2026-11-11): the picture a click opens, so nobody sees more than before. It is 700 px
wide where there is room and smaller in a narrower or lower window (the panel is 360 px: full size from a window of
1084 px, 316 px at 700 px); with less than 200 px free it does not show and the click remains. It takes the side of
the panel with more room, which is the right in a right-to-left language. Mouse only: a touch has no hover. It needs
the loaded thumbnail for the picture's shape, and a preview that fails to load is not tried again.

### Undoing versions

Switching versions off freezes what there is. To get the library back as it was, an administrator undoes them
(decided 2026-11-12): a button in the Versions settings, shown only while versions are off (with them on,
the files would be combined again at once), starts the job `AssetVersionUndo` through Immich's own "create a job"
endpoint (`ManualJobName`, so the admin gate is Immich's and there is no new route; a test goes through the real
route and its guard). The job refuses while versions are on, checks again before every photo, and one runs at a time.
Photo by photo, in one transaction each (`AssetVersionRepository.undo`), under the lock a pairing of that photo takes:

- Each version becomes a photo of its own again, shown as `restoredState` says (pure, `asset-version-undo.ts`): the
  way its photo is now where that is a decision about the shot (locked with a locked photo, archived with an archived
  one, in the trash with a trashed one), otherwise the way it was shown before (`priorVisibility`).
- It is stacked with its photo only if it shared a stack with it when it went behind it (`wasStacked`, recorded
  then because the stack is left, and dissolved when one asset remains). A stack that was dissolved is made anew,
  the photo on top; a stack the photo is still in keeps its own top. A file that was in a stack without its photo
  comes back unstacked.
- What was read about the photo's files is forgotten (the version rows go, and the files' "read" stamps are cleared),
  so the Versions job, run for the missing files once versions are on again, looks at exactly these files and
  combines them again, as the files are then. The base photo's row goes too, unless its picture still comes from
  another file: then it stays, marked stale, until the reset of that picture removes it. Switching on does not go through the library by itself, as ever.
- Spaces and the owner's open apps (`on_asset_restore`) learn that the files are shown again, and a photo that
  showed an edit is rendered from its own file (the edit job finds no version and removes the look).
- The missing runs of search, face detection, text recognition and duplicate detection are queued; duplicate
  detection forgets these files first, because it left a photo out while an edit was behind it.

A run that stops half way is finished by running it again: the photos done are done, a photo's stale picture is
marked in the transaction that undoes it (the cleanup, which every run starts with, has it rendered), and the
analysis is queued by every run.

Not put back: what hung on a version before it went behind its photo (an album, a favourite). It was on the photo too,
which is why the file could go behind it, and it is still there. A file that arrived while versions were on was never
a photo of its own: it comes back as one in the timeline, as it would have been without versions.

## Switching back (rule 3)

The migration's `down()` and the revert script do the same to the photos and their versions. A photo whose picture
came from an edit shows its own
file again: its edited files, which have the edit baked in, are dropped, its thumbhash cleared and its size set back
to its own file's, so the missing-thumbnails job makes them again from what is left (crop, rotate, mirror), as the
script does for colour adjustments. Every version is shown again by the rule of [Undoing versions](#undoing-versions),
which their SQL repeats: as its photo is now (locked, archived or in the trash with it), else as it was shown before,
and stacked under its photo only if it shared a stack with it. A version whose photo is gone is shown alone, in the
timeline or the archive as before, then the table goes (and the two stamp columns, in `down()`).
The revert script also strips the settings paths `server.assetVersions` and `job.assetVersions` from the system
config row, which stock Immich would not accept; `down()` leaves the config row alone, like the fork's other
migrations.

## Upstream footprint (rule 5)

A registration or a call each, a few lines at most: `enum.ts` (queue, four job names, one manual job name), `services/job.service.ts`
(the manual job), `dtos/config.dto.ts` (job concurrency entry),
`dtos/queue-legacy.dto.ts`, `services/queue.service.ts` (queue → job), `services/server.service.ts` (feature flag),
`services/media.service.ts` (thumbnails for hidden versions; the look, beside the colour adjustment's in
`generateEditedThumbnails`), `services/asset.service.ts` (the editor refused on a photo that shows an edit), `services/duplicate.service.ts`
(shots with an edit left out of duplicate detection), `utils/access.ts` (a version reachable only as its photo is: one
wrapped call, also for shared links), `repositories/access.repository.ts` (the fork's version lookup, mounted beside
its other access classes), the web lines that mount the Versions section and the settings, plus tests that enumerate
those lists and the access mock. Everything else is
in `src/gallery/`, `src/schema/tables/asset-version.table.ts`, two columns of `asset-job-status-gallery.table.ts`, `migrations-gallery/`,
`web/src/lib/gallery/versions/`, `mobile/lib/gallery/versions/`, `i18n/gallery/`.

## Known limits

- **A reset and a new render of the same photo, almost at once.** A reset removes the photo's edited files and
  queues the deletion of their paths; Immich names a photo's edited files the same on every render
  (`<id>_preview_edited.jpeg`, `StorageCore.getImagePath`). A new render that writes and registers them before that
  deletion job runs loses its files to it, while the look stays recorded as current. Immich's own editor has the same
  window (remove every crop, then crop again). Closing it needs a render-specific path or deletion by generation, a
  change to Immich's file naming, so it is left; `getOutdatedLooks` heals the case where the rows go too, and
  "Regenerate thumbnails" heals this one.
- **A pairing made before a conflicting file arrives stays** ("once chosen"): a RAW and a JPEG combine, and a second
  RAW of the same name taken nine seconds after the JPEG, uploaded later, is left on its own. When all the files are
  there before the jobs run, the search around the files to be paired leaves the JPEG alone. Not inside a folder:
  a file stored beside a combined pair under the same name joins it, whenever it arrives (the folder rule).

## Later

- **Smarter recognition**, where the effort goes instead of manual controls: test exports from the editors not yet
  verified (Capture One, DxO, Affinity, Luminar, Apple and Google Photos); edits of one shot whose source is not in
  Gallery (two exports of a RAW kept elsewhere share an `OriginalDocumentID` but have no file to hang on); the edit
  date from inside the file (`History` `when`, `ModifyDate`) where file times were reset.
- **Face and OCR boxes that follow an edit's crop** (Lightroom records it in `crs:` tags).
- **Phone edits that the app uploads over their original** as versions instead of upstream's stacking of edited
  re-uploads: they need a canonical parent and a durable retry protocol in the app. (An edited copy a phone saves as
  a file of its own is recognised by its name where the name is an edit's alone, an iPhone's `IMG_E1234.JPG`; a
  Pixel's `PXL_…~2.jpg` is not, a copy carries the same mark.)
- **C2PA** `parentOf` ingredients as evidence that a file is an edit of another (exiftool reads JUMBF but does not
  validate signatures).
- A check on real phones that a changed picture replaces the cached one, and a benchmark of the Versions job on a
  large library.
