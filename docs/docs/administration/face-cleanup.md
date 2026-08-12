# Face Cleanup

## What it is

During the misattribution event, automatic identity merges fused face clusters from different people — some clusters
ended up contaminated with another person's photos. The Face Cleanup console finds these mixed clusters and lets an
admin **re-home** the impostor faces to their true owner.

The affected person keeps all of their real faces, their name, and their thumbnail. This tool is **not** a
person-merge: by default it only moves the scan-flagged impostor faces and leaves the cluster intact. An admin
can also open the **whole cluster** to add faces the scan missed, or move an entire _unnamed_ cluster into its
owner in one action — see [Seeing the whole cluster](#seeing-the-whole-cluster).

## When to use it

Gallery's automatic repair handles clusters that are lightly contaminated (under 50% impostor faces). The Face
Cleanup console handles the rest — the "over-cap" clusters where the contamination is high enough to need human
confirmation before anything moves.

If someone's People page shows photos that clearly belong to a different person, run the Face Cleanup console.

## Two ways to clean up

**Administration → Face cleanup** opens a chooser with two modes. They write exactly the same records, so a
decision made in either is permanent and is respected by the other — and by every future scan.

|               | **Guided cleanup**                            | **Manual review**                         |
| ------------- | --------------------------------------------- | ----------------------------------------- |
| Starts from   | a scan                                        | a person you pick                         |
| Shows you     | the faces the scan flagged, worst first       | **every** face on that person             |
| Best when     | you want the likeliest mistakes found for you | you already know whose cluster is wrong   |
| Needs a scan? | yes                                           | **no** — it works on a brand-new instance |

Guided cleanup is the rest of this page. Manual review is described under
[Manual review](#manual-review).

Neither mode is "the" way to do it. If you know that a particular person's photos are wrong, going straight to
manual review is faster than scanning the whole library and hunting for them in the results.

:::note
While a scan is running, manual review is unavailable. Applying changes during a scan would conflict with the
snapshot being built, so the chooser disables it until the scan finishes rather than letting you stage a pile of
decisions and lose them.
:::

## How to use it

1. Go to **Administration → Face cleanup** and choose **Guided cleanup**.
2. Click **Re-scan**. The scan runs while the facial recognition queue is idle; it completes in seconds to minutes
   depending on the number of faces on the instance.
3. Work the two lanes the scan sorts flagged clusters into:
   - **Ready to auto-fix** — unnamed, small clusters with a single clean owner. Nothing here needs opening:
     **Approve all** re-homes the whole batch in one action, or approve them one at a time. Use **Exclude from
     this batch** to hold a cluster back, or **Review them** to open the lane and go face by face instead.
   - **Needs your review** — named people, large clusters, or clusters whose impostor faces route into another
     flagged cluster (badged `also flagged`). Nothing here is touched until you open it. Open each row, decide
     each face (see [the six actions](#the-six-actions)), then press **Apply**.

The two lanes are independent: approving the auto-fix batch does not touch anything in the review lane, and vice
versa.

### Operating order

Clean **owner-first**: start with the people that have the smallest flagged percentage. Rows badged `also flagged`
mean their suspected owner is itself flagged — resolving the owners first turns those rows green in the next scan.

### The six actions

On a person's review page, every flagged face has to end in one of six states before that person leaves the
cleanup queue. Nothing is written until you press **Apply**.

| Action              | What it does                                                                       |
| ------------------- | ---------------------------------------------------------------------------------- |
| **Move to owner**   | the default — sends the face to the person the scan thinks it actually is          |
| **Move to person…** | sends it to someone you pick instead, including a new person                       |
| **Keep here**       | the face really is this person; declines the suggestion so future scans drop it    |
| **Confirm & lock**  | like Keep here, but permanent and owner-agnostic — no future scan can flag it      |
| **Unknown person**  | a real face that isn't this person and you can't name; parks it in its own cluster |
| **Not a face**      | retires the crop entirely. **This is the only irreversible action**                |

**Keep here** vs. **Confirm & lock** is the distinction worth learning. Keep here answers one scan's question —
if a later scan suspects a _different_ person, the face can be flagged again. Confirm & lock silences it for
good, survives the person being merged or deleted, and is the right choice for faces that genuinely don't
resemble their owner: childhood photos, big age gaps, costumes, heavy shadow.

Declines and locks can be undone later from the [Resolutions](#reviewing-and-undoing-decisions) page.

## Seeing the whole cluster

The review page opens on the scan's **suggestions** — the impostor faces the detector flagged. But the scan only
flags the faces it is confident about, and sometimes you want to act on the rest of the cluster too. Below the
suggestions, the **Rest of this cluster** section lists every other face still assigned to the person, loaded a
page at a time (clusters can hold thousands of faces, so the list pages with **Load more** rather than loading
them all at once).

Two extra actions sit on that section:

- **Add individual faces.** Click any face in the Rest section to add it to the move. It goes to the same
  destination already shown on the screen (the cluster's primary suspected owner) — the same place the suggested
  faces are heading. Use **Select all loaded** to add every face currently on screen. The Stays/Moves strip and
  the **Move N faces** button update live to include your picks.
- **Move the entire cluster.** When the unnamed cluster is _entirely_ one person, **Move entire cluster** moves
  _every_ remaining face — suggestions included — to the primary owner in one action. Because this empties the
  cluster, it asks for confirmation first.

### Emptied clusters

Moving an entire **unnamed** cluster into its owner empties it; the now-empty unnamed cluster is **deleted** so no
orphan placeholder is left behind — the result reads like a clean merge into the owner. A **named** person emptied
this way is **kept** (its name is deliberate state) and simply drops off the console.

The destination is always the one owner shown on the screen — there is no per-face destination picker. If the scan
snapshot no longer knows a primary owner for the cluster, the add-faces and move-entire-cluster actions are
disabled (the suggestions can still be applied to their per-face owners as usual).

## Manual review

Manual review lets you audit **any** person without running a scan first.

1. Go to **Administration → Face cleanup** and choose **Manual review**.
2. Pick the owner, then search or browse to the person.
3. The review page lists **every** face on that person — not just suspicious ones.
4. Select the faces that are wrong and apply an action.

The interaction is the same as guided review: select tiles, then apply. The actions differ slightly, because
there is no scan making a suggestion to accept or reject:

| Action              | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| _(default)_         | **Nothing.** Faces you do not touch are left exactly as they are      |
| **Move to person…** | reassigns the face to another person in the same owner's library      |
| **Confirm & lock**  | records that you verified this face — future scans will never flag it |
| **Unknown person**  | a real person you cannot name; parks the face in its own new cluster  |
| **Not a face**      | retires the crop entirely. **This is the only irreversible action**   |
| **Unmark**          | undoes a mark you have not applied yet                                |

**Faces you leave alone are not recorded.** This is deliberate: marking every face you glanced at as
human-verified would stop future scans from ever flagging them, hiding real mistakes later. If you _want_ that
permanence for a particular face, use **Lock** on purpose.

The consequence is that re-auditing the same person later starts from a clean slate.

### Working through a large cluster

The page loads faces in pages, so **Select all** covers the faces currently loaded — the header shows
`showing N of M` so you always know the difference. Marks and selections survive loading more.

To act on an entire cluster without paging through it, use **Move entire cluster**, which is resolved on the
server and requires you to pick a destination.

## Unattributable faces

Some contaminating faces have no confident external owner — their embedding does not resemble any other person's
cluster strongly enough to make a safe assignment. These faces are **left as-is on purpose**: moving them to an
arbitrary cluster would create new errors. They appear in the **Unattributable** stat tile and are counted in the
totals, but they are not presented for action.

## Advanced scan

The **Advanced** button next to Re-scan opens a tuning modal for a single scan run. Three knobs are exposed,
pre-filled with the instance's effective defaults:

- **Match sensitivity** (0.1–1, default = the facial-recognition _maximum distance_ setting, typically 0.5) — how
  close two faces must look to be treated as the same person. Lower = stricter (fewer matches), higher = looser.
- **Matching faces required** (≥ 1, default = the facial-recognition _minimum faces_ setting, typically 3) — how many
  of a face's lookalikes a person must already own before the scan treats them as its likely owner. The same number
  also decides when a person is too small to be credited with its own faces: a face whose current person holds fewer
  than this is flagged as soon as a credible alternative owner exists, without having to beat it on votes. People
  below the threshold are therefore checked **more** closely, not skipped — raising this value flags more small
  clusters, not fewer.
- **Contamination cap** (0–1, default 0.5) — if more than this share of a person's faces look wrong, the whole
  cluster goes to review-only instead of auto-repairing. Higher = more aggressive auto-repair.

Tuned values apply **to that scan run only** — they are stored with the scan (so the review page and the apply step
compute with the same values), but they are never saved as new defaults. Re-opening the modal always shows the
server defaults again.

## Dismissing false positives

If the scan flags something that is actually correct, you can teach it to stop asking:

- **Dismiss** (row action in the **Needs your review** lane) — drops the whole cluster from the queue. It will not
  reappear in future scans unless new evidence shows up (a different suspected owner).
- **Keep here** / **Confirm & lock** (per-face, on a person's review page) — records that an individual face
  belongs to the person it is already on. See [The six actions](#the-six-actions) for how the two differ.

## Reviewing and undoing decisions

**View resolutions** on the scan page opens `Administration → Face cleanup → Resolutions`, a log of every "this
face is not that person" decision recorded on the instance — from the admin console _and_ from the face
suggestions users review on their own People pages. Filter by **All sources**, **Admin cleanup**, or **User
reviews**.

Each entry has an **Undo** action that clears the decision, so the face becomes eligible to be flagged or
suggested again.

:::note
Moves are not listed here — Resolutions records negative decisions ("not this person") and locks. To reverse a
move, open the affected people on the People page and reassign the faces.
:::

## The face-suggestion distance

Face suggestions use their own distance, which must be **greater** than the facial-recognition _maximum
distance_ — a suggestion is by definition a face that recognition was not confident enough to assign, so an
equal or lower value can never surface anything.

When you have not set the suggestion distance yourself, it defaults to **0.7, or the recognition distance plus
0.2 if that is higher**. This matters on upgrade: an instance that had already raised its recognition distance
to 0.7 or beyond gets a suggestion distance derived from it, rather than an inverted band that would refuse to
start (config-file installs) or reject every settings save (database installs).

Once you set the value explicitly it is yours, and is never adjusted again. If you later raise the recognition
distance above it, saving is rejected with a message naming both numbers — raise the suggestion distance to
match. At the schema maximum of 2 no valid band exists, so suggestions are switched off and a warning is
logged.

## Safety

- The scan and the apply step both **refuse to run while facial recognition is active**. If you see a 409 conflict
  message, wait for the recognition queue to drain and try again.
- Applying a repair **assigns the impostor faces directly to their suspected owner** (an admin-confirmed manual
  assignment). The move is immediate and durable — facial recognition will not re-cluster a manually assigned face,
  so the faces cannot drift back to the wrong person. Once an apply succeeds the affected rows leave the list.
- All moves are reversible: open the affected people on the People page (or run a new scan and use the console) to
  move faces back if needed.
- A **fully-contaminated cluster** (every face flagged) is always classified _Review these first_ with an
  `over-cap` badge — it can never be bulk-approved via the pre-selection. Approving it from its review page moves
  all of its faces, after which the emptied person is removed by the regular cleanup job.
- **Instances that ran a pre-release build of this feature must be reset, not upgraded in place.** A handful of
  fork migration names that shipped in early release candidates were later renamed or removed as the face review
  and cleanup engines were unified. A database that recorded one of those names has no matching migration file on
  disk in later builds and fails to boot with a "corrupted migrations" error naming the missing migration. There
  is no automatic upgrade path for this — reset the instance (fresh database) rather than carrying it forward.
