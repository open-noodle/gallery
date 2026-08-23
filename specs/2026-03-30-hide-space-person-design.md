# Hide Person from Space People Context Menu

**Discussion:** [open-noodle/gallery#226](https://github.com/open-noodle/gallery/discussions/226)
**Date:** 2026-03-30

## Problem

The space people overview's three-dot menu only has "Merge people". Users must leave
the space and navigate to `/people` to hide a person, breaking their curation workflow.

## Solution

Add a "Hide person" menu item to the existing context menu on each person card in the
space people page. Single file change plus one E2E test.

### Implementation (web/src/routes/(user)/spaces/[spaceId]/people/+page.svelte)

1. **Add imports:** `mdiEyeOffOutline` icon + `toastManager` from `@immich/ui`

2. **Add handler:**
   - Call `updateSpacePerson()` with `{ isHidden: true }` (API already exists and is imported)
   - Update the local person's `isHidden` to `true` in the `people` array
   - The existing `visiblePeople` derived (`people.filter(p => !p.isHidden)`) handles removal
   - Show toast via `toastManager.primary($t('changed_visibility_successfully'))`
   - Error handling via existing `handleError()`

3. **Add menu item** above "Merge people" in the `ButtonContextMenu`:
   - Icon: `mdiEyeOffOutline`
   - Text: `$t('hide_person')` (existing i18n key)
   - Only visible to editors (already gated by `isEditor` check on the menu container)

### What we don't need

- No server changes -- API already supports `isHidden` via `PUT /shared-spaces/:id/people/:personId`
- No new i18n keys -- reusing `hide_person` and `changed_visibility_successfully`
- No OpenAPI regeneration -- no endpoint changes
- No undo toast -- the existing "Show and hide people" visibility modal serves as the undo path

## Testing

One focused E2E test (Playwright):

- Navigate to space people page
- Hover a person card, click three-dot menu
- Click "Hide person"
- Verify person disappears from the grid
- Verify toast notification appears

No unit test -- creating a test file for this page requires significant mock scaffolding
for minimal value. E2E provides higher confidence for this UI interaction.

## Edge Cases

| Edge Case               | Handling                                                                |
| ----------------------- | ----------------------------------------------------------------------- |
| Hide last visible       | `visiblePeople` becomes empty, "No people" empty state renders          |
| Network error           | `handleError` catches, person stays visible (mutation is after `await`) |
| Non-editor user         | Menu not rendered (gated by `isEditor`)                                 |
| Menu auto-close on hide | `optionClickCallbackStore` in MenuOption handles this automatically     |
