# Search hotkey label follows the platform

## Problem

The `/search` page's notice reads "Use ⌘K to search." on every platform. The command palette's real
binding is ⌘K only on Apple platforms and Ctrl+K elsewhere (`global-search.svelte` already shows
`Ctrl+K` in its own trigger), so Linux and Windows users are told a shortcut that does nothing.

## Change

- `lib/utils/search-hotkey.ts`: `isApplePlatform(platform?)` and `searchHotkeyLabel(platform?)`, the
  existing check from `global-search.svelte` moved into one place, which now imports it.
- `search_legacy_notice` takes a `{hotkey}` value in `en` and the nine maintained locales
  (`de fr it nl pl es ru zh_Hans zh_Hant`). Only the literal `⌘K` was swapped for the placeholder; the
  surrounding wording is untouched. Other locales keep their text and simply ignore the unused value.
- The search page passes `searchHotkeyLabel()`.

## Tests

`search-hotkey.spec.ts` covers Apple (`MacIntel`, `iPhone`, `iPad`, `iPod`) and non-Apple
(`Linux x86_64`, `Win32`, `Linux armv8l`, empty) platform strings. The global-search and search page
suites pass unchanged.
