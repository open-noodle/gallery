# i18n overlay: fork strings out of upstream locale files

Status: implemented (fork-layering wave 2, item 2.11).

## Problem

The fork kept its strings inside upstream's `i18n/<locale>.json`: 1,294 added English keys, 9 reworded
upstream keys, 35 upstream keys whose English it kept but whose translations it replaced, and per-locale
edits across 57 files. Those files are sorted, so every upstream Weblate
sync and every fork string PR touched the same regions, and i18n was the largest stop count in each
rebase (13 + 5 stops in the v3.3.0 and v3.3.1 cycles).

## Design

- `i18n/*.json` are upstream's files, byte-identical to the upstream tag. A rebase takes them as-is.
- `i18n/gallery/<locale>.json` is the overlay: keys the fork added, plus the fork's text for upstream
  keys it rewords. Same format and sorting as upstream (nested JSON, prettier with `sort-json`).
- `i18n/gallery/overrides.txt` lists the upstream keys the overlay deliberately overrides: 9 reworded in
  English (and translated), and 36 translation-only overrides, where the overlay keeps its own translations
  of upstream's unchanged English. Each translation-only line carries `en:<hash>`, the first 8 hex digits of
  the SHA-256 of the upstream English it was translated against. That includes a key upstream has not
  translated in some locale yet (`manage_people` in `zh_Hant`): the merge would take the overlay value
  without a listing, but then nothing would pin the English.
- `i18n/gallery/merge.mjs` (Node, no dependencies) builds the bundle into the gitignored
  `i18n/gallery/merged/`, one file per upstream locale.

Merge rule, per locale and per leaf key:

1. Start from upstream.
2. For each `exclusive` key in `overrides.txt`, drop upstream's value.
3. Add every overlay leaf that upstream does not define, or whose key `overrides.txt` lists.

So upstream wins on any collision that is not listed. A listed key takes the overlay text where the
overlay has it and keeps upstream's translation elsewhere; `exclusive` also drops upstream's translation
in locales the overlay does not translate, because it translates the old wording (the location-permission
disclosures: falling back to English beats a stale translation there).

`merge.test.mjs` pins this rule (`node --test`). `merge.mjs --check` (both run in CI's "Test i18n" job) reports overlay leaves that upstream now defines without a
listing (dead: upstream wins), overrides that equal upstream (redundant), listed keys upstream no longer
has, overlay files without an upstream locale, overlay translations of an upstream key that the same
upstream locale lacks and `overrides.txt` does not list, and translation-only overrides whose `en:` tag is missing or
no longer matches upstream's English (upstream reworded it, so the fork's translations describe the old
text: review them, then update the tag). An upstream translation improvement to a key the fork overrides
stays shadowed; that is the cost of keeping the fork's wording, and a rebase can drop an override line
once upstream's translation is as good. A rebase that adds a same-named upstream key therefore
fails CI instead of silently replacing the fork's text.

## Who reads the bundle

| Consumer | How |
| --- | --- |
| Web (dev, build, vitest, svelte-check, tsc) | `web/svelte.config.js` calls `writeMergedI18n()` and points `$i18n` at `i18n/gallery/merged`; `galleryI18nVitePlugin` in `vite.config.ts` rebuilds on change during `vite dev`. The `Translations` key type in `app.d.ts` comes from the merged `en.json`. |
| Mobile codegen | `mise //mobile:i18n:merge`, a dependency of `i18n:loader` (`easy_localization:generate -S ../i18n/gallery/merged`) and `i18n:keys` (`bin/generate_keys.dart`). |
| Key-checking tests | web `src/lib/i18n*.spec.ts`, `src/lib/i18n/*.spec.ts`, mobile tests and widget-test `EasyLocalization(path:)` read the merged dir; the two server memory-rule specs union the upstream and overlay `en.json` keys. |
| Branding | `patch_i18n` step 0 runs `merge.mjs --out i18n` and deletes the overlay, so branding and `verify-branding.sh` see the shipped bundle and later merges cannot re-apply unbranded overlay values. `test-i18n-branding.sh` copies the overlay into its temp tree. |
| Server Docker build | `server/Dockerfile` copies all of `i18n/`, so the web stage builds the bundle from it. |

The split was verified behaviour-neutral: for all 89 locales the merged bundle equals the pre-split
files, except 56 upstream translations the fork had dropped while English was unchanged (seven
`admin.storage_template_*` keys in seven locales, six zh_Hans keys, one ru key). Those come back.

## Translation service

Gallery has no Weblate project. The nine maintained locales of fork strings are written in code PRs, other
locales fall back to English, and upstream's strings in every locale arrive with each rebase, translated
through Immich's Weblate. If Gallery ever sets up its own Weblate project, its component for the overlay
needs these settings:

| Setting | Value |
| --- | --- |
| Component name / slug | Gallery / `gallery` |
| Source code repository | `https://github.com/open-noodle/gallery.git` |
| Repository branch | `main` |
| File format | JSON nested structure file (`json-nested`) |
| File mask | `i18n/gallery/*.json` |
| Monolingual base language file | `i18n/gallery/en.json` |
| Template for new translations | empty (new locales start as `{}`) |
| Edit base file | off: English is written in code PRs |
| Language filter | default (`^[^.]+$`); `overrides.txt` and `merge.mjs` do not match `*.json` |
| Add-ons | "Customize JSON output" (indent 2, sort keys); "Cleanup translation files" so keys deleted from `en.json` leave the other locales |
| Push | to branch `chore/translations` (the labeler's translation label), squashed |

Such a project must not get a component for `i18n/*.json`: those files track upstream byte for byte and any
edit is lost at the next rebase. Weblate output may not match prettier's key order exactly, so run
`pnpm format:fix` on the translation branch before merging (CI's "Test i18n" job fails otherwise).
`weblate-lock.yml` (an upstream workflow) does not reach the overlay: its filter `i18n/!(en)**\.json` is a
picomatch glob whose `**` does not cross `/`, so it matches `i18n/de.json` but not `i18n/gallery/de.json`.
The workflow is also disabled in the repository settings ("Weblate checks", disabled manually). Leave the
file as it is so it stays close to upstream.
