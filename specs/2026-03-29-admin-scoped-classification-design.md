# Admin-Scoped Auto-Classification

## Summary

Move classification categories from per-user to admin-only. The admin defines categories that apply to all users' assets globally. Regular users get a read-only view of the categories.

## Motivation

Classification categories are currently scoped per-user — each user creates and manages their own. In practice, the admin is the one defining meaningful categories, and having them apply globally is more useful than requiring each user to duplicate the setup.

## Database Changes

### Migration (`1777000000000-AdminScopedClassification.ts`)

Located in `server/src/schema/migrations-gallery/`.

**Operation ordering is critical:**

1. **Find admin user**: `SELECT id FROM "users" WHERE "isAdmin" = true ORDER BY "createdAt" ASC LIMIT 1`
2. **Rename conflicting categories**: For each non-admin category whose name already exists under the admin account, suffix with ` (username)`. This must happen before reassigning userId to avoid unique constraint violations.
3. **Reassign all categories**: `UPDATE classification_category SET "userId" = :adminId`
4. **Drop `tagId` column** (FK to tags, index dropped automatically by Postgres)
5. **Drop `userId` column** (FK to users)
6. **Replace unique constraint**: `(userId, name)` → `(name)`

### Schema Table (`classification-category.table.ts`)

Remove:

- `userId` field + `@ForeignKeyColumn(() => UserTable)`
- `tagId` field + `@ForeignKeyColumn(() => TagTable)`

Update:

- `@Unique({ columns: ['name'] })`

### Tag Behavior on Deletion/Rename

- **Category deletion**: Existing `Auto/{name}` tags on all users' assets are left intact. They serve as useful metadata even without the category.
- **Category rename**: Existing `Auto/{oldName}` tags are not retroactively renamed. Renaming a category only affects future classifications.

## Server Changes

### Controller (`classification.controller.ts`)

Split auth levels:

| Method | Route                             | Auth                              |
| ------ | --------------------------------- | --------------------------------- |
| GET    | `/classification/categories`      | `@Authenticated()` (any user)     |
| POST   | `/classification/categories`      | `@Authenticated({ admin: true })` |
| PUT    | `/classification/categories/:id`  | `@Authenticated({ admin: true })` |
| DELETE | `/classification/categories/:id`  | `@Authenticated({ admin: true })` |
| POST   | `/classification/categories/scan` | `@Authenticated({ admin: true })` |

### Service (`classification.service.ts`)

- `getCategories()`: Remove userId filter — return all categories.
- `createCategory(auth, dto)`: Remove `userId` from insert values. Auth param kept for admin guard.
- `updateCategory(auth, id, dto)`: Remove userId ownership check (keep the `getCategory` existence check + NotFoundException). Remove the tag-rename-deletion block (`if (dto.name !== existing.name && existing.tagId) { ... }`) — tagId column no longer exists.
- `deleteCategory(auth, id)`: Remove userId ownership check (keep existence check). Remove `tagRepository.delete(category.tagId)` call.
- `scanLibrary(auth)`: Call `resetClassifiedAt()` with no userId (resets ALL assets). Queue `AssetClassifyQueueAll` with no userId.
- `handleClassify({ id })`: Call `getEnabledCategoriesWithEmbeddings()` with no userId — load all enabled categories. Tag creation always calls `upsertTags({ userId: asset.ownerId, tags: ['Auto/{name}'] })` on every match. Note: the current code caches a `tagId` on the category row to avoid repeated tag lookups; dropping the `tagId` column removes this optimization, introducing an N+1 upsert-per-match pattern. Acceptable for now; could be optimized with in-memory caching per job batch later.
- `mapCategory()`: Remove `tagId` from type signature and mapping body.
- `onConfigUpdate`: Already works globally (`getAllCategories()` + `data: {}` which makes the optional userId undefined) — no changes needed.

### Repository (`classification.repository.ts`)

- `getCategories()`: Remove `userId` parameter and WHERE clause.
- `getCategoriesWithPrompts()`: Remove `userId` parameter and WHERE clause.
- `getEnabledCategoriesWithEmbeddings()`: Remove `userId` parameter and WHERE clause. Remove `tagId` from select.
- `resetClassifiedAt()`: Remove `userId` parameter. Update all rows: `SET classifiedAt = NULL WHERE classifiedAt IS NOT NULL` (the `IS NOT NULL` guard is a new optimization to avoid touching already-null rows).
- `streamUnclassifiedAssets()`: Remove the optional `userId` parameter (currently `userId?: string`). Always stream all unclassified assets.

### DTOs (`classification.dto.ts`)

- `ClassificationCategoryResponseDto`: Remove `tagId` field.
- Create/Update DTOs: No changes.

## Web Changes

### Admin Panel

- Move `user-settings-page/classification-settings.svelte` → `admin-settings/classification-settings.svelte`
- Register in `/admin/system-settings/+page.svelte` as a new `SettingAccordion` section with i18n keys and icon
- The component manages its own state via direct API calls (not `systemConfigManager`) — consistent with its current pattern
- Rename "Scan Library" → "Scan All Libraries" with a confirmation dialog

### User Settings

- Replace the CRUD component with a read-only list
- Show: category name, action type, enabled status, similarity level
- No edit/delete/create/scan buttons
- Info text: "Classification categories are managed by your administrator"
- Calls the same `GET /classification/categories` endpoint

### SDK

- Regenerate TypeScript SDK (`make open-api-typescript`)
- Regenerate Dart SDK (`make open-api-dart`)
- No mobile UI changes (mobile has no classification UI)

## Job Pipeline

- `AssetClassifyQueueAll`: Change job data type from `{ userId?: string }` to `{}`. Always processes all unclassified assets.
- `AssetClassify`: Loads categories globally, applies to any asset. Tags created with `asset.ownerId`.
- `onConfigUpdate` path already works this way — no changes.

## Testing

### Unit Tests (`classification.service.spec.ts`)

- Remove userId from all test setups
- Test that non-admin users cannot create/update/delete categories
- Test that any user can read categories
- Test scan resets all assets globally

### Medium Tests (`classification.repository.spec.ts`)

- Remove userId from queries
- Test `UNIQUE(name)` constraint (was `UNIQUE(userId, name)`)
- Test migration: categories merged correctly with username suffixing

### E2E Tests (`classification.e2e-spec.ts`)

- Test admin-only access: non-admin gets 403 on POST/PUT/DELETE/scan
- Test non-admin can GET categories (200)
- Test global scan classifies assets across multiple users

## Known Trade-offs

- **Tag upsert N+1 (regression)**: The current code caches a `tagId` on the category row to skip repeated tag lookups. Dropping the `tagId` column removes this optimization — every asset×category match now calls `upsertTags`. Acceptable at current scale; can add per-batch in-memory cache if performance becomes an issue.
- **resetClassifiedAt full table update**: Touches every row in `asset_job_status`. Confirmation dialog in UI mitigates accidental triggers. No index needed — the UPDATE with `WHERE classifiedAt IS NOT NULL` is efficient enough.
- **Trashed assets re-scanned**: `resetClassifiedAt` without userId filter includes trashed assets. Wasted cycles are minimal; trashed assets won't meaningfully match categories.
- **Orphaned tags on rename/delete**: By design. Tags are independent metadata once applied.
