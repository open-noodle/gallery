# Person covers: pick each person's thumbnail by quality

**Date:** 2026-11-21
**Status:** Accepted on discussion 1339 (the three-state rule, on by default, the margin, space people, identities);
implemented with this doc. Prototyped first as an external script against a Gallery 5.11.1 instance through the API.

## Summary

A person's thumbnail (their cover) is the face that happened to start their cluster, and nothing ever looks at it
again. When that face goes away, the replacement is whichever face Postgres returns first. In practice many covers are
dark, blurry, tiny, half turned away, or old: a 2007 photo for someone photographed every year since, a childhood scan
for an adult. Owners can fix a cover by hand with **Select representative face**, but with dozens of people nobody
does it for all of them, and a cover fixed once is not revisited as better photos arrive.

With this feature the server picks covers from the person's own faces: sharp, well exposed, large, typical of the
person, and from the recent end of their photos. It does so for unnamed people too, where it matters most: a
recognisable face is what lets the owner put a name on a group. It is on by default and follows one rule: **the job
only replaces a cover it knows was picked automatically.** A cover chosen by hand is never replaced, and a person who
existed before this version keeps their cover unless the owner clicks **Choose automatically** on them or an admin runs
the job on **All**. The job runs after face recognition; it keeps the current cover unless a candidate is clearly
better, so covers do not change after every run. Space people follow the same rule through their existing
`representativeFaceSource`.

## How it works today

1. **Creation.** `PersonService.handleRecognizeFaces` (`server/src/services/person.service.ts`) creates a person with
   `faceAssetId` set to the face that created it: the first face of that cluster the recognition job reached. Other
   paths create people too: EXIF face regions (`MetadataService`), `POST /people`, group splits.
2. **Replacement.** When the cover face is reassigned, deleted or hidden, `createNewFeaturePhoto` calls
   `PersonRepository.getRandomFace`. Despite its name it is not random: it is the first visible face Postgres returns,
   with no ordering. The same fallback runs in the thumbnail queue (`MediaService`), merges
   (`IdentityMergePropagationService`), face suggestions, pet recognition and the repair jobs.
3. **By hand.** Upstream's `PUT /people/{id}` with `featureFaceAssetId` takes the person's face on a given asset (the
   asset viewer's "Set as featured photo", and the stock Immich apps). The fork's `PUT /people/{id}/representative-face`
   takes an exact face, from the picker in `specs/2026-05-03-representative-face-picker-design.md`.
4. **No provenance for personal people.** Nothing records which of these set the current cover.
5. **Space people do record it.** `shared_space_person.representativeFaceSource` is `auto` or `manual` (migration
   `1778500000000-AddSpacePersonRepresentativeFaceSource`). Picking a face in a space sets `manual`; resetting sets
   `auto`. Dedup and the identity backfill only replace `auto` covers, and `repairInvalidRepresentativeFaces` turns a
   `manual` pick back to `auto` once its face is no longer valid in the space. An `auto` space person shows the
   viewer's own personal cover for its identity, else a linked personal cover whose face is in the space, else its own
   `representativeFaceId` (`SharedSpaceService.getSpacePersonThumbnail`).
6. **Identities.** `face_identity.representativeFaceId` has no source column. Only the two hand-pick paths write it
   (`GalleryPeopleService.updateRepresentativeFace` and `SharedSpaceService.updateSpacePersonRepresentativeFace`), so in
   practice it holds the identity's last hand-picked face.
7. **Pixel scoring already exists.** Library Cleanup scores whole images with `laplacianVariance` and `exposureStats`
   (`server/src/gallery/utils/cleanup.ts`). The video-face sampler picks each person's best view _inside one video_
   (`specs/2026-10-31-video-face-frames-design.md`). Nothing compares a person's faces across assets.

## Measured on one library

The rules below were prototyped as a script on a personal Gallery instance (10,860 assets, 72 named and 343 unnamed
people, photos from 1960s scans to 2026 phone pictures), reading the database and previews and setting covers through
the API. The prototype's covers were applied on 2026-11-21, and the owner compared all 72 named people side by side (old
cover, new cover): much better overall. The rules then changed in three ways, each measured on the same library:

- dates read from scan file names (`1990 05 24 …`), which the prototype used, are left out (see "Not in this
  proposal");
- the pool needs half of a person's faces rather than always 10 (see `k` below);
- the photo's date enters the score with a weight of 0.15. The owner compared the versions with and without it on the
  30 people where any of these changes mattered, and leaned towards the one with the date: better in some cases, not
  all.

| Covers of the 72 named people                           | Before | Prototype | This design |
| ------------------------------------------------------- | ------ | --------- | ----------- |
| Median face size in the preview (short side of the box) | 127 px | 209 px    | 184 px      |
| Median cosine similarity to the person's mean embedding | 0.764  | 0.811     | 0.801       |
| Median year of the photo                                | 2015   | 2020      | 2023        |
| More than 5 years older than the person's latest photo  | 40     | 21        | 12          |
| Covers changed                                          |        | 68        | 67          |

"Before" is over the 71 people whose old cover is a candidate face (below). This design picks the same face as the
prototype for 41 of the 72: it gives up some face size for more recent faces.

Of the 343 unnamed people, 289 have at least one candidate face and 202 at least two; one candidate leaves nothing to
choose. This design gives 146 of those 202 a new cover. Over the 200 whose old cover is a candidate, the median face
goes from 92 to 118 px, and the similarity to the group's mean embedding from 0.866 to 0.871: unnamed groups are small,
so their faces are close to their mean already.

Misses, which these rules do not fix:

- **Only scans.** A person known only from scans has no trusted date, so recency cannot help: an adult with nine
  scanned photos, five of them from childhood, gets a childhood cover, the largest and sharpest face.
- **Scanners that write a camera make.** One scan batch carries the make `DSC IMAGE` and the day it was scanned, so its
  photos pass for camera photos of that day. Without the date in the score, one person's cover was a 2004 photo scanned
  in 2023, although that person has photos from 2025 and 2026; with it, such a scan no longer wins on this library, but
  it still enters the pool.
- **Occlusion.** For a person with 5 photos, the sharpest face is partly hidden behind someone else's head. Nothing in
  the score sees occlusion, closed eyes or pose beyond what typicality catches.
- **Few recent photos.** 12 of the 72 named people still have a cover more than 5 years older than their latest photo,
  mostly people photographed a lot in one period and rarely since.

**Cost.** Scoring needs one preview read per candidate face. All 5,517 candidate faces of the 72 named people were
scored in 19 s on 6 threads of an Intel i5-14400F, about 20 ms a face, and the 960 of the unnamed people in 4 s. With
the cap of 40 faces per person below, a full run reads 1,469 previews for the named people and 858 for the unnamed
ones: never more than one per face in the library.

## Goals and non-goals

**Goals**

- A good default cover for every new person, named or not, without the owner doing anything.
- Never replace a cover someone chose by hand, on a personal person or on a space person, including a pick made through
  the stock Immich API or apps.
- Leave the covers of people who existed before this version alone unless someone opts in.
- Revisit an automatic cover when the person has gained many faces since, without changing it for a marginal gain.
- Lay the ground for propagating a hand-picked cover through its identity (a later PR, below).
- Nothing changes for stock Immich clients or for a database switched back to Immich beyond the covers themselves.

**Non-goals**

- Propagating a hand-picked cover to the identity's other profiles. This PR only avoids overriding a profile that
  propagation would cover.
- Pets. Pet faces come from a different detector and embedding; the same idea could follow.
- Video faces as candidates (see "Decisions").
- Detecting occlusion, closed eyes or pose: that needs a model, not pixel statistics.

## Choosing a cover

`pickCover` in `server/src/gallery/utils/person-cover.ts` is pure: candidates in, one face id out. It runs in two
stages, so the first needs no pixels and the second reads at most 40 previews. The rules are the prototype's variant C,
unchanged; the code gave no reason to change them.

### Candidates

Every person or space person that is not hidden and not a pet, named or not, is considered.

A personal person's candidates are their faces that are visible, not deleted, have an embedding (`face_search`), and
are not a video face (no `asset_face_video_frame` row), on an asset that:

- is an image, not a video (video faces are cropped from their best frame, not from the preview this score reads);
- is not deleted, not offline, and has `visibility = 'timeline'` (never a locked, hidden or archived photo: the cover is
  shown wherever the person is);
- carries exactly one face of that person. Two faces of one person on one photo means one of them is misfiled, and the
  score cannot tell which.

A space person's candidates are the same, taken from its `shared_space_person_face` rows, on assets reachable in the
space by the existing rule (`isSpacePersonRepresentativeFaceValid`: a space asset, a space library or a space album),
again with `visibility = 'timeline'`.

A profile with fewer than two candidates keeps its cover, and no preview is read; the job only records the count.
The one exception is a profile with no cover at all, which takes its only candidate.

### Pool: recent enough, large enough

A candidate's date is **trusted** when its asset has a camera make in EXIF or the owner edited its date
(`asset_exif.lockedProperties` contains `dateTimeOriginal`). Other images (scans, screenshots, images saved from
messaging apps) carry the day they were scanned or received, which says nothing about how old the face is. When a
person has no trusted candidate, all candidates are used with their stored date.

Let `n` be the number of trusted candidates and `latest` the most recent of their dates (`asset.localDateTime`). The
pool is the trusted candidates within the first of 3, 6, 10 and 20 years before `latest` that holds at least
`k = min(10, max(3, ceil(n / 2)))` of them, or all of them if none does.

`k` is 10 for anyone with 20 or more trusted faces: enough faces to choose from without going back further than
needed. For someone with fewer, half of them is enough. With a flat 10, anyone with fewer than 10 trusted faces fell
through to all of them, whatever their dates.

The pool is then cut to its 40 largest faces (short side of the face box, in the coordinates face detection stored).
The largest faces are where the sharp ones are, and the cap bounds the work per person.

### Score

For each face of the pool, the unedited preview (the image the box was detected on, which the person thumbnail job
reads too) is read once and the face box cropped and reduced to 128 × 128 grey pixels. Up to four previews are read at
once, since a remote storage backend makes each read a round trip.
From that crop:

- **sharpness** = `laplacianVariance`;
- **brightness** and **clippedDark** = `exposureStats`.

A face is kept when `64 ≤ brightness ≤ 204` and `clippedDark < 0.25`. If no face is kept, all of the pool is. A face
whose preview cannot be read is left out.

**Typicality** is the cosine similarity of the face's embedding to the normalised mean of all the person's candidate
embeddings. It penalises profile views, sunglasses and motion blur the detector still embedded, and misfiled faces,
which sit far from the person's centre. The mean is computed in the server, not with `avg(vector)`, which pgvecto.rs
does not implement.

`score = 0.35 · rank(sharpness) + 0.30 · rank(typicality) + 0.20 · rank(size) + 0.15 · rank(date)`, each rank scaled
to 0–1 within the kept faces, the date being `asset.localDateTime`. The highest score wins; a tie goes to the more
recent face.

The window already keeps old photos out of the pool; the date term then prefers the newer of two faces that are
otherwise close. Without it, 18 of the 72 named people had a cover more than 5 years older than their latest photo,
against 12 with it, but the median face was larger (206 px against 184 px).

Ranks, not raw values: the measures have unrelated scales, and Laplacian variance moves with preview size and JPEG
quality, so ranks need no per-library calibration. The prototype defined a dark pixel as below 20 instead of
`exposureStats`' 8 or below; with the fork's definition this design picks the same face for 70 of the 72 named
people.

### Keeping the current cover (hysteresis)

Ranks shift whenever faces are added, so the top of a pool often changes between two faces that are nearly tied. The
job therefore keeps the current cover when it is among the kept faces and the best face scores less than
**`PERSON_COVER_MARGIN = 0.10`** above it. A current cover that is not among the kept faces (it left the window, fell
out of the 40 largest, failed the exposure filter, or is not a candidate at all, such as a video face or a face on a
photo now locked) is replaced by the best face.

The margin was measured by replaying the same library: for the 100 people with at least 6 candidates, faces were added
in upload order from half of them to all of them in ten steps of 5%, with a pick at each step.

| Margin | Cover changes in 1,000 runs | of which by score | Kept cover below the best, at most / 90th percentile |
| ------ | --------------------------- | ----------------- | ---------------------------------------------------- |
| 0      | 199                         | 166               | 0 / 0                                                |
| 0.05   | 136                         | 101               | 0.05 / 0.005                                         |
| 0.10   | 106                         | 69                | 0.10 / 0.027                                         |
| 0.15   | 90                          | 52                | 0.15 / 0.096                                         |
| 0.20   | 81                          | 39                | 0.20 / 0.126                                         |

The other changes are forced: the old cover left the pool. At 0.10 the changes driven by score drop by 58%, and a kept
cover is at most a tenth of the score range below the best, in practice much less. Larger margins save a few more
changes but keep visibly worse covers. A face one rank better on every measure gains `1/(m − 1)` in a pool of `m`
kept faces, so in a pool of 40 the challenger must be about four places better on average; in a pool of 3 any face
that is better on most measures wins.

**Implementation check.** On the same library, with the server's own pixel path (`sharp` reading the previews),
`pickCover` picks the prototype's face for 231 of the 270 people with two or more candidates, and 24 of the other 39 are
within the margin of it. Fed the prototype's own pixel values it picks the same face for 249 of 270, and for 269 once
the prototype ranks ties by their average rank as this implementation does; the rest of the gap is the resampling
kernel (`sharp` against PIL), not the rules. The 1,638 previews of those pools were read and scored in 20 s, about
12 ms a face.

The margin applies to the job (Missing and All). **Choose automatically** has no margin: the owner asked for the best
face now.

`PERSON_COVER_VERSION` is stamped on every automatic pick. Changing what `pickCover` returns bumps it, and the next
Missing run re-picks every automatic cover from an older version, like `CLEANUP_QUALITY_VERSION`.

## Where a cover came from

### Personal people: `person_cover`

```ts
@Table('person_cover')
@Check({ name: 'person_cover_source_chk', expression: `"source" IN ('auto', 'manual', 'unknown')` })
export class PersonCoverTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  personGroupId!: string;

  @Column({ type: 'uuid', nullable: true })
  faceId!: string | null; // the cover this row is about; no foreign key, see below

  @Column({ type: 'character varying' })
  source!: 'auto' | 'manual' | 'unknown';

  @Column({ type: 'integer', nullable: true })
  candidateCount!: number | null; // candidates when the job picked; null for manual and unknown

  @Column({ type: 'smallint', nullable: true })
  version!: number | null; // PERSON_COVER_VERSION of that pick; null for manual and unknown

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  pickedAt!: Timestamp; // when this cover was set
}
```

A row **holds** while its `faceId` equals `person.faceAssetId`. The three states agreed on the discussion:

| State       | Stored as                         | Missing run | All run | Choose automatically |
| ----------- | --------------------------------- | ----------- | ------- | -------------------- |
| automatic   | no row, or `auto`, or a row that no longer holds | may replace | may replace | picks |
| hand-picked | `manual`, holding                 | never       | never   | picks                |
| unknown     | `unknown`, holding                | never       | may replace | picks             |

The discussion named the unknown state "no row". This design stores it as a row instead, written once by the migration
for every person that has a cover (`INSERT … SELECT … 'unknown'`), and lets "no row" mean automatic. The behaviour is
the same three states; what differs is which side needs a write. People are created by recognition, EXIF face
regions, `POST /people`, group splits, and whatever a future rebase adds. With "no row = unknown", each of those paths
would need a hook writing `auto`, and a path without one would silently produce people the job never touches. With
the unknown rows written by the migration, a new person needs nothing: whatever created it, the job may pick its cover.
A person with no cover at migration time gets no row: there is nothing to protect.

A row that no longer holds counts as automatic. Every path that rewrites `person.faceAssetId` without choosing a face
by hand (the `getRandomFace` fallbacks, a merge, a face moved to another person or deleted, the repair jobs, a video
rescan, pet recognition) breaks the match, and that is the right answer: the face someone chose, or the face that
existed before this version, is gone. Writing `auto` from each of those paths would record exactly what the mismatch
already says, so they keep their upstream text. `faceId` needs no foreign key onto `asset_face` for the same reason:
a deleted face just stops matching, and the fork adds no seventh FK on an upstream key.

Every write of `person.faceAssetId`, and what `person_cover` records:

| Path                                                             | Records                                      |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `PersonService.update` with `featureFaceAssetId` (upstream `PUT /people/{id}` and `PUT /people`, stock apps) | `manual` (one call into the fork module) |
| `GalleryPeopleService.updateRepresentativeFace` (the picker)     | `manual`                                     |
| The job and **Choose automatically**                             | `auto` with `candidateCount` and `version`   |
| `getRandomFace` fallbacks (`createNewFeaturePhoto`, the thumbnail queue, merges, face suggestions), repair, video and pet paths | nothing; the row stops holding, and the next Missing run picks |
| Person creation, any path                                        | nothing; no row is automatic                 |

### Space people: `representativeFaceSource` and `shared_space_person_cover`

A space person already records its source: `manual` is never replaced, `auto` may be. There is no unknown state: the
column has existed since `1778500000000`, and the picker that writes `manual` came with it. The job's bookkeeping for
space people goes in a sibling fork table rather than new columns on `shared_space_person`, so the paths that create,
merge, reset and copy space people (dedup, identity backfill, face-match rebuilds) neither carry it nor reset it by
accident, and a deleted space person takes its row with it:

```ts
@Table('shared_space_person_cover')
export class SharedSpacePersonCoverTable {
  @ForeignKeyColumn(() => SharedSpacePersonTable, { onDelete: 'CASCADE', primary: true, index: false })
  spacePersonId!: string;

  @Column({ type: 'uuid', nullable: true })
  faceId!: string | null; // holds while it equals shared_space_person.representativeFaceId

  @Column({ type: 'integer', nullable: true })
  candidateCount!: number | null;

  @Column({ type: 'smallint', nullable: true })
  version!: number | null;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  pickedAt!: Timestamp;
}
```

The job writes it with each automatic pick. `updateSpacePersonRepresentativeFace` (a fork file) writes it too on a hand
pick, with `candidateCount` and `version` null, so every space cover chosen from now on has a `pickedAt`; the source
stays on `representativeFaceSource`, the one place it was already true. Resetting a space person to automatic queues a
pick for it.

### Identities

The job does not override a profile when any profile of the same `face_identity` has a hand-picked cover the profile
could take as its own:

- for a personal person, a hand-picked face that is one of its own faces;
- for a space person, a hand-picked face that is a valid representative face in its space
  (`isSpacePersonRepresentativeFaceValid`).

A hand-picked cover is a holding `manual` row of a personal person linked to the identity (`person_identity`), or a
space person of the identity with `representativeFaceSource = 'manual'`. When the hand-picked face is unreachable (it
is not a face of this person, or its asset is not in this space), the job picks as usual. **Choose automatically**
ignores this rule: the owner asked for this person.

The job never writes `face_identity.representativeFaceId`. Today only the two hand-pick paths write it, so it reads as
the identity's last hand-picked face; an automatic pick written there would erase that.

**Ready for propagation.** A later PR that carries a hand-picked cover to the identity's other profiles needs to know
whether the identity has a hand-picked cover, which face, and which pick is the latest. All three can be derived from
these tables without a source column on the identity: the holding `manual` rows of `person_cover`, the space people
with `representativeFaceSource = 'manual'`, and `pickedAt` on both tables to order them. Propagation then sets each
reachable profile's cover and records it (a new `person_cover` state such as `identity` only needs the check
constraint widened), and the job's identity rule above already keeps it from undoing that.

## When it runs

- **Setting.** `machineLearning.facialRecognition.covers.enabled`, a `GalleryFacialRecognitionExtension` entry, default
  **on**. Admin UI under Machine Learning > Facial Recognition: "Choose person thumbnails automatically. Picks a sharp,
  well-lit, recent face for new people and keeps it up to date. Never replaces a thumbnail chosen by hand; people from
  before this setting keep theirs unless you run the Person thumbnails job on All."
- **Jobs.** `PersonCoverQueueAll { force }`, `PersonCover { id, force }` and `SpacePersonCover { id, force }` on a new
  fork queue, `personCover`, concurrency 1, listed on the Jobs page as **Person thumbnails** with Missing and All.
  - **Missing** (`force: false`) takes the automatic profiles whose pick is stale: no row (a personal person created
    since), a row that no longer holds, a `version` older than `PERSON_COVER_VERSION`, or a `candidateCount` that has
    grown by at least a quarter since the pick. Unnamed groups grow a face at a time, and a group of 2 that reaches 3
    is cheap to look at again (3 preview reads). The growth test counts the profile's raw faces first, on their index,
    and its candidates only when that count could have grown enough, so a run over fresh picks scans no candidates.
  - **All** (`force: true`) takes every profile whose cover is not hand-picked, including the unknown ones. The Jobs
    page confirms it with the only warning this feature needs: "Thumbnails chosen by hand before this version cannot
    be told apart from automatic ones and may be replaced. Thumbnails chosen by hand since are kept."
  - Both skip the identity rule's profiles, and do nothing while the setting is off. Hidden people and pets are never
    queued.
- **After recognition.** `handleFaceIdentityMaintenanceAfterRecognition` runs once a recognition run has drained; it
  also queues `PersonCoverQueueAll { force: false }`. Callers queue cover jobs whatever the setting; the handlers check
  it, so the rule lives in one place.
- **After a lost cover.** The fallbacks keep their immediate first face, so a person never has no thumbnail. Their rows
  stop holding, so the next Missing run picks a better face. No fallback is hooked: there are six of them, mostly in
  upstream files, and the mismatch already finds them all.
- **Choose automatically.** `POST /people/{id}/representative-face/auto` (`GalleryPeopleController`) picks for one
  personal person and returns the updated `PersonResponseDto`. It reads at most 40 previews, so it answers within about
  a second. It works whether the setting is on or off, since the owner asked, and turns a `manual` or `unknown` row into
  `auto`. A person with one candidate gets that face; `400` when the person has none. The web shows it in the person
  page menu, next to **Select representative face**, for personal people only.

A personal pick sets `person.faceAssetId`, upserts `person_cover`, and queues `PersonGenerateThumbnail`, in one
transaction that first locks the person row and re-checks its state, so a hand pick made while the previews were being
read wins. A space pick updates `representativeFaceId` only while `representativeFaceSource` is still `auto`, and
upserts `shared_space_person_cover`.

## Access

`POST /people/{id}/representative-face/auto` requires `Permission.PersonUpdate` through `requireAccess`, which only the
owner holds (`checkOwnerAccess`). Space editors, who may pick an exact face with `updateRepresentativeFace`, cannot run
it: it may choose a face on an asset they cannot see. The gate is `checkAccess` with an existing permission, so the
access oracle already covers it and its snapshot does not change; the controller spec pins the permission.

| Actor                              | Choose automatically |
| ---------------------------------- | -------------------- |
| Owner of the person                | allowed              |
| Editor of a space the person is in | 400                  |
| Viewer of a space the person is in | 400                  |
| Other user                         | 400                  |
| Server admin, not the owner        | 400                  |

(`requireAccess` answers `400 Not found or no person.update access`, as for every other owner-only person route.) The
jobs are admin-only through the existing Jobs endpoints.

## Version pairings

- **Stock Immich apps, older Gallery apps:** they see the new thumbnail. `person.faceAssetId` keeps upstream's meaning,
  the thumbnail is regenerated by the existing job, and `person.updatedAt` changes, so sync carries it. No new field
  reaches them. A cover they set with "Set as featured photo" goes through `PersonService.update` and is kept.
- **Space thumbnails:** served by the existing endpoint, which already busts caches on `updatedAt`.
- **Web:** ships with the server. Against an older server the setting block is hidden (no `covers` in the config) and
  **Choose automatically** fails with the usual error toast.
- **Mobile:** unchanged; **Choose automatically** is web-only in this version.
- **Stock Immich server on a Gallery database:** it ignores both tables. A cover it sets by hand is not recorded, so
  back on Gallery it counts as automatic.
- **Switching back to Immich:** the covers stay; they are plain `faceAssetId` and `representativeFaceId` values.
  `scripts/revert-to-immich.sql` drops `person_cover` and `shared_space_person_cover`. The migration's `down()` drops
  them too: they hold only provenance and bookkeeping, which upstream has no column for, so there is nothing to move
  back.

## Layering compliance

New fork files: `server/src/gallery/utils/person-cover.ts` (`pickCover`, the margin, the face crop reader),
`server/src/gallery/services/person-cover.service.ts` (jobs, action, writes),
`server/src/gallery/repositories/person-cover.repository.ts` (candidate, selection and identity queries),
`server/src/schema/tables/person-cover.table.ts`, `server/src/schema/tables/shared-space-person-cover.table.ts`, a
migration in `server/src/schema/migrations-gallery/`, the setting in `server/src/gallery/dtos/config.dto.ts`, the menu
action in `web/src/lib/gallery/people/person.service.ts`, the admin block in
`web/src/lib/gallery/components/admin/person-cover-settings.svelte`, and strings in `i18n/gallery/` (English and the
nine maintained locales).

Upstream files gain only registration lines and calls into the fork module: `server/src/enum.ts` (three `JobName`, one
`QueueName`), `server/src/dtos/config.dto.ts` and `server/src/dtos/queue-legacy.dto.ts` (one queue entry each),
`server/src/services/queue.service.ts` (one `case`), `PersonService.update` (one call), the web Jobs page and job settings queue lists, `MachineLearningSettings.svelte` (one component line) and the
person page menu (one action).

`person_cover.personGroupId` is a fork foreign key onto `person_group_pkey`, listed in
`server/src/schema/gallery-upstream-fks.json`. That key already carries eight fork FKs and is the one `ClusterGroups`
rebuilt; this makes nine, the same pattern as `person_pet` and `person_identity`, and the upstream preflight flags any
incoming migration that rebuilds it. `shared_space_person_cover` hangs off a fork table and needs no entry.

## Testing

- **`pickCover`, unit:** the window (each step of 3/6/10/20 years, the fall-through to all), `k` for small and large
  `n`, no trusted date, a date edited by the owner, the 40-face cap, the exposure filter and its fallback, the ranking
  and the tie on date, two candidates, the margin (kept below it, replaced above it, replaced when the current cover is
  not kept).
- **Pixels, unit:** on a generated image, a blurred copy of the face ranks below the original, and a darkened copy is
  filtered out.
- **`PersonCoverService`, unit:** the three-state rule for Missing, All and the action (no row, `auto`, holding and
  stale `manual`, holding and stale `unknown`); people with one candidate are recorded without reading a preview; the
  setting off makes the jobs no-ops but not the action; the identity rule for personal and space people, reachable and
  not; space `manual` is never touched; a pick queues the thumbnail and never writes the identity's representative
  face; `PersonService.update` with `featureFaceAssetId` and `updateRepresentativeFace` both write `manual`; the space
  hand pick writes its row and the reset queues a pick; the after-recognition hook queues Missing.
- **Medium (database):** the candidate query leaves out videos, video faces, locked, hidden and archived assets,
  deleted and offline assets, invisible and deleted faces, faces without an embedding, photos with two faces of the
  person, and other people's faces; the space candidate query keeps only faces reachable in the space; the selection
  queries for Missing and All over every state; the migration's unknown rows; the identity queries; the FK registry and
  revert-to-Immich specs.

## Not in this proposal

- **Propagation through identities** (see "Identities"): a later PR.
- **Dates from file names.** Scans named `1990 05 24 …` give their real date back, which the prototype used: it would
  change 6 of the 72 named people's covers on the measured library. Immich does not parse file names anywhere else,
  and naming habits vary; an owner can fix a scan's date in the UI, which this design trusts.
- **A suggestion in the picker.** The picker could mark the face `pickCover` would choose.
- **Rescoring without reading previews again.** Storing each face's sharpness and exposure would let a Missing run read
  only new faces. Not needed at about 20 ms a face.
- **Choose automatically on mobile and on space people.** A space person is reset to automatic with the existing
  control, which now queues a pick.

## Decisions

The open questions of the first draft, as settled on the discussion:

1. **Default.** On everywhere. The three-state rule makes it safe: new installs get the full benefit, existing
   libraries get it for new people and new unnamed groups, which gain the most.
2. **Existing covers.** Left alone unless someone opts in, per person (**Choose automatically**) or for everyone (an
   All run, which alone carries the warning).
3. **Weight of the date.** Fixed at 0.15, not an admin setting: weights of 0.05 and 0.10 sit in between (15 and 13
   covers more than 5 years behind, median faces of 200 and 194 px), and no admin can judge the trade-off without the
   measurement above.
4. **Video faces.** Not candidates in this version: their best frame has its own quality (detector score × size ×
   sharpness) on a different scale, and mixing the two needs its own measurement.
5. **Foreign key.** One more fork FK on `person_group_pkey`, like the other person sidecars.
6. **Churn.** A margin of 0.10 on the score, measured above.
