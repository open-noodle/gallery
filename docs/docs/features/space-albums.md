# Space Albums

Space Albums let you bring whole **albums** into a [Shared Space](shared-spaces.md). Instead of adding photos one by one, you link an existing album (or create a new one inside the space) and all of its photos appear in the space for every member — organised on a dedicated **Albums** tab, just like the main Albums page.

:::info Permissions Model
Like the rest of Shared Spaces, album actions are governed by the space's three roles — **Owner**, **Editor**, and **Viewer**. Owners and Editors manage albums; Viewers browse them read-only. See [Roles and Permissions](#roles-and-permissions) below.
:::

## How it works

- **Linked by reference.** Linking an album doesn't copy anything — the album stays in its owner's library and simply becomes visible inside the space. Unlinking it later removes it from the space without touching the original album.
- **A space can hold many albums.** Each space has its own **Albums** tab listing every album linked into it, with the same search / sort / group / view controls as your personal Albums page.
- **Two ways photos land in a space album:**
  - **Owner-added photos** — the album owner (or an editor of the album) adds their own photos to the album, exactly like a normal album.
  - **Cross-owner contributions** — a space Editor or Owner can add photos they _don't_ own into a linked space album. These become **contributions**: they show up in the album for all members, but they never leave their real owner's library. See [Contributions](#contributions).
- **Independent timeline control.** Each linked album has its own "show in the space's photos" switch (Owners/Editors), and every member can separately hide any album from just their own timeline. See [Showing album photos in the timeline](#showing-album-photos-in-the-timeline).

## Roles and Permissions

| Permission                                         | Owner | Editor | Viewer |
| -------------------------------------------------- | ----- | ------ | ------ |
| Browse the Albums tab                              | Yes   | Yes    | Yes    |
| Search / sort / group / switch album views         | Yes   | Yes    | Yes    |
| Open a space album and view its photos             | Yes   | Yes    | Yes    |
| Download photos from a space album                 | Yes   | Yes    | Yes    |
| Link an existing album into the space \*           | Yes   | Yes    | No     |
| Create a new album inside the space                | Yes   | Yes    | No     |
| Unlink an album from the space                     | Yes   | Yes    | No     |
| Add / remove photos in a space album               | Yes   | Yes    | No     |
| Contribute photos you don't own (cross-owner)      | Yes   | Yes    | No     |
| Toggle "hide from the space's photos" for an album | Yes   | Yes    | No     |
| Hide/show an album on just your own timeline       | Yes   | Yes    | Yes    |

\* Linking also requires that you are the **owner or an editor of the album itself** — you can only link albums you are allowed to manage.

## The Albums tab

Open a space and select the **Albums** tab to see every album linked into it. The toolbar mirrors your personal Albums page:

- **Search** albums by name or description.
- **Sort** by title, item count, date created/modified, or newest/oldest photo.
- **Group by** — None, Year, **Linked by** (which member linked the album), or Owner, with expand/collapse per group. Albums whose linker is unknown fall into an "Unassigned" group.
- **Cover ↔ List** view — switch between album-style cover cards and a compact list.

Viewers get the full toolbar (search, sort, group, view) but no create/link/edit buttons — the tab is read-only for them.

## Linking and creating albums

Owners and Editors can add albums to a space in two ways.

### Link an existing album

1. Open the space and go to the **Albums** tab.
2. Click **Link album**.
3. Pick one of your albums from the list and confirm.

The album's photos immediately appear in the space for all members. You can only link albums you own or have editor access to.

### Create a new album in the space

1. On the **Albums** tab, click **Create album**.
2. Give it a name.

The album is created, automatically linked into the space, and opened so you can start adding photos right away.

## Contributions

When you (as an Owner or Editor) add photos to a linked space album that you **don't own**, those photos become **contributions**. This is how members collaborate on a shared album across libraries:

- Contributions appear in the album's grid and counts for every member, and members can view and download them — the same access they get for any space photo.
- The photos never leave their real owner's library; a contribution is just a reference into the space.
- Contributions are tied to the album's link. If the album is **unlinked** from the space, contributions are withdrawn; **re-linking** the album restores them.

:::note
You can't remove an asset from a space directly if it's only present through a linked album — remove it from the **album** instead. The app will point you to the album(s) responsible when this happens.
:::

## Showing album photos in the timeline

Whether a linked album's photos show up in a timeline is controlled by two independent switches, each on the album's ⋯ menu:

1. **"Hide this album from the space's photos"** (Owners/Editors only) — governs whether the album appears on the space's own Albums/Photos tabs at all, for **every member**. Turn it off to keep an album browsable but out of the space's aggregated view.
2. **"Hide this album from my timeline"** (any member, yourself only) — a personal preference that removes just this one album from **your own** main Photos timeline, Folders view and Memories, without changing what anyone else sees or what the space itself shows. The same menu switches it back on again.

These don't combine with AND: hiding an album from the space's photos does **not** also remove it from any member's personal timeline — each member decides that for themselves with switch 2. Switch 2 is available to every member including Viewers, since it only changes your own view. See [Timeline Integration](shared-spaces.md#timeline-integration) for the full picture, including the space-level "hide all space photos from my timeline" switch, the truth table for when a photo disappears from your timeline, and [where hiding applies](shared-spaces.md#where-hiding-applies).

Switch 2 only removes an album's photos when the album is the **only** way they reach you. If the same photos also arrive through a linked library or were added to the space directly, hiding the album changes nothing for them — the confirmation dialog says so, and gives the count that stays.

Hiding is a tidiness feature, not a privacy feature — it never restricts anyone's access to the album or its photos.

## Editing a space album

The space album page behaves like a regular album for Owners and Editors — you can rename it, add or remove photos, and set its cover. Changes are reflected for all members, and album activity (created, renamed, photos added/removed) is recorded in the space's [activity log](shared-spaces.md#activity-log). Viewers see the album read-only.

## Removing and unlinking

- **Unlink an album** (Editor/Owner) from the Albums tab to remove it — and its photos and contributions — from the space. The original album is untouched.
- **Removing individual photos** from a space album is done on the album itself. A photo that's in the space only because of a linked album can't be removed from the space's main view directly.

## Notes and limitations

- A photo can be in the space's direct pool **or** contributed through an album, never counted twice — the space de-duplicates across all sources.
- **Member contribution counts** on the Members tab include photos brought in through linked albums and libraries, not just directly-added photos.
- Space albums are available on both **web and the mobile app**; some album-management actions on mobile require a recent server version.
