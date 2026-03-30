# Classification: Wipe + Rescan on Stricter Similarity

## Summary

When an admin increases a classification category's similarity threshold (making it stricter), offer to remove existing auto-tags that may no longer match, unarchive photos that were archived by that category, and rescan all photos.

## Motivation

Currently, changing a category's similarity threshold has no effect on already-classified assets. If an admin makes a category stricter, photos tagged under the old (looser) threshold remain tagged and archived even though they wouldn't match under the new threshold.

## Design

### Server

**DTO change** — add `rescan?: boolean` to `ClassificationCategoryUpdateDto`:

```typescript
@IsBoolean()
@IsOptional()
@ApiPropertyOptional({ description: 'Wipe existing auto-tags for this category and rescan all assets' })
rescan?: boolean;
```

**Service change** — in `updateCategory`, after applying the update, if `dto.rescan` is true:

1. Call `removeAutoTagAssignments(existing.name)` — uses the **pre-update** category name to target the correct `Auto/{name}` tags. This method also unarchives any assets that were tagged (moves them from Archive back to Timeline visibility).
2. Queue `AssetClassifyQueueAll` with `force: true` — rescans all assets against all categories.

The wipe (`removeAutoTagAssignments`) runs inline in `updateCategory` — it's a fast SQL DELETE. The rescan is queued as a background job. The server honors `rescan: true` unconditionally — it doesn't duplicate the "is it stricter?" check. The UI gates the dialog, but the API is a general-purpose "wipe and rescan this category" operation.

**New repository method** — `ClassificationRepository.removeAutoTagAssignments(categoryName: string)`:

1. Find all tag IDs matching `Auto/{categoryName}` across all users:

   ```sql
   SELECT id FROM tag WHERE value = 'Auto/{categoryName}'
   ```

2. Find all asset IDs that have these tags:

   ```sql
   SELECT "assetId" FROM tag_asset WHERE "tagId" IN (...)
   ```

3. Unarchive those assets (move from Archive back to Timeline):

   ```sql
   UPDATE asset SET visibility = 'timeline'
   WHERE id IN (...) AND visibility = 'archive'
   ```

4. Delete the tag-asset associations:
   ```sql
   DELETE FROM tag_asset WHERE "tagId" IN (...)
   ```

Note: `upsertTags` creates a hierarchy — `Auto/Screenshots` produces a parent `Auto` tag and a child `Auto/Screenshots` tag. Only the leaf tag's (`Auto/{name}`) asset associations are removed. The shared `Auto` parent tag is left intact.

### Web (Admin Component)

**Dialog flow** — when the admin clicks Save on a category edit:

1. Compare `formSimilarity` against the stored `category.similarity` from the categories list (no need to track a separate "original" variable — the category object retains the pre-edit value)
2. If `formSimilarity > category.similarity` (stricter), show confirmation dialog
3. Dialog text: "This category is now stricter. Would you like to remove existing auto-tags that may no longer match, unarchive affected photos, and rescan all photos?"
4. If confirmed: call `updateCategory` with all changed fields + `rescan: true`
5. If declined: call `updateCategory` with changed fields only (no `rescan`)
6. If similarity didn't increase: call `updateCategory` normally (no dialog)

### What Triggers the Dialog

Only a similarity **increase** (stricter threshold). These do NOT trigger the dialog:

- Similarity decrease (looser — new matches found on next scan)
- Name change only
- Action change only
- Prompt changes only
- Enable/disable toggle

## Testing

### Unit Tests (classification.service.spec.ts)

- `updateCategory` with `rescan: true` calls `removeAutoTagAssignments(existing.name)` then queues `AssetClassifyQueueAll` with `force: true`
- `updateCategory` with `rescan: false` does NOT call `removeAutoTagAssignments` or queue
- `updateCategory` with `rescan: undefined` does NOT call `removeAutoTagAssignments` or queue
- `updateCategory` with `rescan: true` and name change uses the **old** name for wipe

### Medium Tests (classification.repository.spec.ts)

- `removeAutoTagAssignments` deletes `tag_asset` rows for `Auto/{name}` tags
- `removeAutoTagAssignments` does NOT delete `tag_asset` rows for other tags
- `removeAutoTagAssignments` unarchives assets that had the `Auto/{name}` tag
- `removeAutoTagAssignments` does NOT unarchive assets without the tag
- `removeAutoTagAssignments` with nonexistent tag is a no-op

### Web Component Tests

- Dialog appears when similarity increases on save
- Dialog does NOT appear when similarity decreases or stays the same
- Confirmed dialog sends `rescan: true` in API call
- Declined dialog sends update without `rescan`

### E2E Tests

- `PUT /classification/categories/:id` with `{ similarity: 0.5, rescan: true }` returns 200

## Edge Cases

- **`rescan: true` without similarity change** — honored by server, UI won't send it but API accepts it
- **Category disabled + rescan** — tags wiped, assets unarchived, rescan skips disabled categories
- **No matching tags exist** — `removeAutoTagAssignments` is a no-op
- **Category renamed in same update** — wipe uses `existing.name` (old name), rescan creates `Auto/{newName}` tags
- **Concurrent rescans** — BullMQ queues them, each runs in sequence
- **Asset manually archived by user** — will be unarchived if it has the `Auto/{name}` tag (acceptable trade-off, classification tags are only created by the system)
- **Asset archived by multiple categories** — if asset matches both `Auto/Screenshots` (tag_and_archive) and `Auto/Memes` (tag_and_archive), wiping Screenshots unarchives it temporarily. The rescan re-archives it when Memes re-matches. Transient inconsistency is acceptable since rescan runs immediately after.

## OpenAPI Regeneration Required

Adding `rescan?: boolean` to the update DTO changes the API spec. Must regenerate TypeScript SDK and Dart client after the server change.
