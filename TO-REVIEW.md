# Shared Spaces Logic Fixes & Tests — Review Checklist

**Branch:** `claude/spaces-logic-testing-PXjtO`
**Commit:** `fix: harden shared spaces permission logic and add comprehensive edge case tests`
**Files changed:** 2

---

## Summary of Changes

### 1. Logic Fixes in `server/src/services/shared-space.service.ts` (+18 lines)

Three defensive checks were added to prevent invalid operations:

| Method | Fix | Why |
|--------|-----|-----|
| `addMember()` | Reject `role === Owner` when adding a member | Prevents privilege escalation — only the creator should be owner |
| `updateMember()` | Reject promotion to `Owner` role | Same privilege escalation guard on role changes |
| `updateMember()` | Check that target member exists before updating | Prevents silent no-op on non-existent members |
| `removeMember()` | Check that target member exists before removing | Prevents silent no-op when removing a non-existent member |

### 2. Comprehensive Tests in `server/src/services/shared-space.service.spec.ts` (+614 lines, 41 new test cases)

Tests were added across every service method to cover edge cases, permission boundaries, and the new logic guards:

**`create`** (2 new tests)
- Null description handling
- Full response field mapping

**`getAll`** (1 new test)
- Empty array when user has no spaces

**`get`** (3 new tests)
- Space not found after membership check
- Zero asset/member counts for empty space
- Editor role access

**`update`** (2 new tests)
- Partial update (description only)
- Full update (name + description)

**`delete`** (3 new tests)
- Editor cannot delete
- Viewer cannot delete
- Non-member cannot delete

**`getMembers`** (4 new tests)
- Non-member rejected
- Viewer can list members
- Editor can list members
- Avatar color null → undefined mapping

**`addMember`** (4 new tests)
- Explicit editor role assignment
- Owner role rejected (new logic)
- Viewer cannot add members
- Non-member cannot add members

**`updateMember`** (5 new tests)
- Viewer → editor promotion
- Editor → viewer demotion
- Owner promotion rejected (new logic)
- Viewer cannot change roles
- Non-existent target member rejected (new logic)

**`updatePreferences`** (2 new tests)
- Editor can toggle showInTimeline
- Owner can toggle showInTimeline

**`removeMember`** (6 new tests)
- Owner can remove editor
- Non-existent member rejected (new logic)
- Viewer can self-remove (leave)
- Editor can self-remove (leave)
- Editor cannot remove others
- Non-member cannot remove others

**`addAssets` / `removeAssets`** (5 new tests each direction)
- Owner can add/remove
- Non-member rejected
- Single asset handling
- addedById tracking

---

## What to Verify

### Run the tests
```bash
cd server
pnpm test -- --run src/services/shared-space.service.spec.ts
```
All 67 tests (26 existing + 41 new) should pass.

### Check type safety
```bash
cd server
npx tsc --noEmit
```

### Review logic correctness
- [ ] **addMember owner guard:** Is it correct that no one can add a member with `Owner` role, or should there be a transfer-ownership flow?
- [ ] **updateMember owner guard:** Confirm there's no legitimate path to promote someone to owner (e.g., ownership transfer feature planned later).
- [ ] **Member existence checks:** Verify that `getMember` returns `null`/`undefined` for non-existent members (not an empty object).
- [ ] **Error messages:** Confirm the `BadRequestException` messages align with the project's error message conventions.

### Integration / E2E
- [ ] Run medium tests if available: `cd server && pnpm test:medium`
- [ ] Run E2E tests if shared-space endpoints are covered: `cd e2e && pnpm test`

### Linting
```bash
make lint-server
make check-server
```
