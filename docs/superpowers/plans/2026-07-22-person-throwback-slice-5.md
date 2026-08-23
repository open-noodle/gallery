# Slice 5 — web admin settings + i18n

Spec: `docs/plans/2026-07-22-memory-person-throwback-spec.md` §3.1 rows 11–13, §3.6, §9 Slice 5.
Depends on Slice 4 (server registration).

## Goal

Make the new type visible and toggleable in admin system settings, with its four English strings.

## Part A — i18n (`i18n/en.json`)

**The key shapes differ between admin and user, and are not what you might guess.** Verified
against the file:

- **Admin** pair lives nested inside the `admin` object (~line 330), named
  `memory_type_<key>_setting` and `memory_type_<key>_setting_description`. It is **not**
  `admin.memory_type_<key>`.
- **User** pair lives at top level (~line 2013), named `memory_type_<key>` and
  `memory_type_<key>_description`.

Add, placed alphabetically among their neighbours (the file is sorted;
`prettier-plugin-sort-json` enforces it):

| Key                                                          | Value                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `admin` › `memory_type_person_throwback_setting`             | `Person throwback`                                                                         |
| `admin` › `memory_type_person_throwback_setting_description` | `Resurface a warm chapter with someone who has not appeared in photos for a year or more.` |
| `memory_type_person_throwback`                               | `Times with someone`                                                                       |
| `memory_type_person_throwback_description`                   | `Occasionally resurface photos of a person you have not photographed in a long while.`     |

Only `en.json`. Do not touch other locales — they are translated downstream. Note `i18n/` is shared
by web **and** mobile; adding keys is safe, renaming is not.

## Part B — the settings component

**`web/src/routes/admin/system-settings/MemoriesSettings.svelte`** — append `'person_throwback'`
last in the `memoryTypeKeys` array (~line 12, currently ending with `'themed'`). Order here drives
the render order; keep it matching the server's registry order.

Nothing else in this component needs changing — the switch, label, and description are all derived
from the key.

## Part C — the component spec

**`web/src/routes/admin/system-settings/MemoriesSettings.spec.ts`** — **one** site: the `types`
object literal in the save-payload assertion (~lines 97–109, currently ending with `themed: true`).
Add `person_throwback: true` last.

There is **no** switch-count assertion in this file — it asserts specific switches by name
(`admin.memory_type_on_this_day_setting` etc.), so no count needs bumping. Do not invent one.

## Part D — VERIFY

```
cd web && pnpm test --run src/routes/admin/system-settings/MemoriesSettings.spec.ts
cd web && pnpm test          # full web suite
cd web && pnpm check:typescript
cd web && pnpm check:svelte
cd web && pnpm lint
```

`pnpm lint` in `web/` has been seen to abort locally on a tscompat crash unrelated to any change.
If it crashes rather than reporting lint errors, note that in your report and continue — CI is the
authoritative lint gate. If it reports actual errors in the files you touched, fix them.

Also confirm the JSON stayed sorted and valid:

```
npx prettier --check i18n/en.json
node -e "JSON.parse(require('fs').readFileSync('i18n/en.json','utf8')); console.log('en.json parses')"
```

## Commit

```
feat(web): expose person_throwback in memory settings
```

Three files: `i18n/en.json`, the Svelte component, its spec.

## Do not

- Touch any locale other than `en.json`.
- Touch server files — Slice 4 owns those and is already committed.
- Touch docs — Slice 6.
