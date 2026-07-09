# Memories

Gallery generates memory cards that resurface meaningful groups of photos on the web and mobile apps. Memories are created by the nightly **Generate memories** task and appear in the memory lane when they are due to be shown.

## Memory types

Gallery supports two memory families:

| Type            | What it shows                                               | Title source                       |
| --------------- | ----------------------------------------------------------- | ---------------------------------- |
| **On this day** | Photos taken around the same calendar day in previous years | App-generated "N years ago" title  |
| **Rule memory** | Server-curated sets such as birthdays and recent trips      | Server-provided title and subtitle |

Each individual type — **On this day**, **Birthdays**, and **Recent trips** — can be enabled or disabled both globally by an admin and per user. See [Generated memory controls](#generated-memory-controls) below.

Saved memories stay available after their normal display window. Hidden or deleted assets are excluded from generated memories.

## Birthday memories

Birthday memories are generated from people with a birthday set on their person record.

Gallery looks for photos of that person up to the target day and prefers a cross-year throwback when enough history exists:

- At least 6 qualifying photos across at least 2 distinct years creates **Happy birthday, Name** with the subtitle **Photos from different years**.
- If there is not enough cross-year history, Gallery can still create a smaller fallback from the 4 most recent qualifying photos, with the subtitle **Recent photos of Name**.
- At most 2 photos per year are used in the cross-year set, and the memory is capped at 12 assets.

Each birthday memory is deduplicated by person and day, so rerunning the nightly task does not create duplicate birthday cards for the same person.

## Recent trip memories

Recent trip memories find a place that looks unusual compared with your recent baseline.

The rule compares the last 30 days of location clusters with the preceding 90 days:

- Gallery first infers a likely home location from the baseline period.
- A trip candidate needs at least 7 photos across at least 2 days.
- The place must be outside the likely home country, or in a different city within the home country.
- If the home location is ambiguous, Gallery skips the rule instead of guessing.
- The same place has a 30-day cooldown so a long trip does not create repeated cards every night.

Trip memories are titled **Recent trip to City, Country** or **Recent trip to Country**. The subtitle shows the number of photos and days in the trip window.

### Trip photo curation

Trip memories try to show representative photos instead of every near-duplicate burst:

- Photos taken within 2 minutes of the previous selected photo are collapsed.
- Small trips keep up to 6 representative photos.
- Medium trips use 7 or 8 photos depending on day and photo count.
- Long trips use up to 10 photos and preserve coverage across the trip window.

## Nightly generation

The **Generate memories** nightly task creates both classic **On this day** memories and rule memories.

Rule memories run only through the current day and are capped at 2 rule-generated cards per user per day. If one rule fails for a user, Gallery logs the failure and continues evaluating the remaining users and rules where possible.

You can enable, disable, or reschedule this task from **Administration → Settings → Nightly Tasks**. The same setting is exposed as `nightlyTasks.generateMemories` in the [config file](/install/config-file).

## Generated memory controls

You can browse retained memories from **Memories** in the Library section of the web sidebar. The page shows all retained generated memories, grouped by the date they were shown. It has local search and an **All/Saved** filter. Opening a card uses the same full-screen memory viewer as the daily memory lane.

### Memory types you can turn on or off

Every memory type is controlled at two independent layers:

- **Admin availability** — a global per-type switch controlled by the admin. A type that is disabled here is never generated for anyone and disappears from every user's settings.
- **Per-user toggle** — for any type the admin leaves available, each user chooses whether they personally receive it.

A user receives a memory type only when it is **both** globally available **and** enabled in that user's own settings.

The three built-in types each have a stable key used in configuration:

| Type key      | Setting label | Controls                                |
| ------------- | ------------- | --------------------------------------- |
| `on_this_day` | On this day   | "N years ago" photo memories            |
| `birthday`    | Birthdays     | Birthday rule memories for named people |
| `recent_trip` | Recent trips  | Recent trip rule memories               |

All three default to **on**.

### Per-user toggles

Each user manages their own memory types from **Account Settings → Features → Memories**. Below the master memory switch, a toggle appears for every memory type the admin has made available. Turning one off:

- stops new memories of that type from being generated for that user, and
- immediately hides that user's existing **unsaved** memories of that type from the memory lane and the Memories page.

Saved memories are always kept and shown, even after their type is later disabled.

### Admin settings

You configure global memory availability and retention from **Administration → Settings → Memories**. If you run Gallery with a [config file](/install/config-file), the settings page is read-only and these values must be changed in the config file instead. Per-user toggles are stored per user and stay user-controlled even when a config file is in use — the config file only sets which types are globally available.

| Setting                  | Default | Behavior                                                                                                               |
| ------------------------ | ------- | ---------------------------------------------------------------------------------------------------------------------- |
| `memories.retentionDays` | `365`   | Number of days to keep unsaved generated memory records. Set to `0` to keep memory records forever.                    |
| `memories.types`         | `{}`    | Per-type global availability map (`{ "<type key>": true \| false }`). Omitted keys default to on (see the keys above). |

Disabling a type globally (for example `"recent_trip": false`) stops generation for everyone, removes the type from every user's settings, and immediately hides existing **unsaved** memories of that type. Saved memories are exempt.

Memory retention only removes unsaved memory records. Saved memories are kept regardless of age. Cleanup uses the memory display date (`showAt`) when available, otherwise it uses the memory creation date. Cleanup still removes links to hidden, archived, or deleted assets even when `memories.retentionDays` is `0`.

The per-type switches only control which memory types are generated and shown. The global `nightlyTasks.generateMemories` setting controls whether the nightly task runs at all — turning it off disables every generated memory type regardless of the per-type and per-user settings.

#### Legacy `birthday` / `recentTrips` fields

Earlier versions exposed two booleans, `memories.birthday` and `memories.recentTrips`. They are **deprecated but still honored** for back-compat as aliases:

- `memories.birthday` ⇒ `memories.types["birthday"]`
- `memories.recentTrips` ⇒ `memories.types["recent_trip"]`

Resolution precedence per type is: an explicit `types[key]` wins, otherwise the legacy boolean is used, otherwise the type defaults to on. Prefer the `types` map for new configuration — it also covers `on_this_day`, which the legacy fields could not control.

Example config-file override that keeps trips, turns off **On this day**, and keeps memory records forever:

```json
{
  "memories": {
    "retentionDays": 0,
    "types": {
      "on_this_day": false,
      "recent_trip": true
    }
  }
}
```

## API behavior

The memory API exposes rule memories with:

- `type: "rule"`
- a flexible `data` object containing the rule id, dedupe key, title, optional subtitle, score, and rule context
- top-level `title` and `subtitle` fields for clients that render server-defined memory labels

Classic **On this day** memories still require `data.year`. This keeps existing clients compatible while allowing new server-curated memory types to carry richer display metadata.
