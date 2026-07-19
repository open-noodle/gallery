# Slice 5 — M5: Asset-level album activity leaks commenter emails — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD, red→green.

**Goal:** `GET /activities?albumId=A` must not return commenter/liker **emails** to a space-only reader.
The C1 fix already strips album-level activity for such readers but keeps asset-level activity, whose
`user` payload still carries the full email + name via `mapUser`.

**Architecture:** In `getAll`, when `!hasDirectAccess`, redact `user.email` to `''` on each mapped
activity — **after** `mapActivity` (so `mapUser`'s `avatarColor` email-fallback already computed).
Matches the existing security-8 pattern (`album.service.ts:115` `albumUser.user.email = ''`).

**Tech Stack:** NestJS. Server-only, no DTO/SDK change.

## Global Constraints (spec §0)

- TDD, positive control before negative. No co-author trailers. Targeted spec + tsc + lint; write e2e,
  defer running to CI.

## Key facts (verified)

- `getAll` (`activity.service.ts:21-42`): `hasDirectAccess` computed at `:29-30`; C1 filter at `:39`;
  returns `visible.map((a) => mapActivity(a))` at `:41`.
- `mapActivity` (`activity.dto.ts:65`) → `{ user: mapUser(activity.user), … }`. `mapUser` computes
  `avatarColor` (email fallback) internally, so redacting `dto.user.email` after the map is safe.

---

### Task 1: Redact `user.email` for space-only readers

**Files:**

- Modify: `server/src/services/activity.service.ts` — `getAll` (`:41`)
- Test (unit): `server/src/services/activity.service.spec.ts`
- Test (e2e): extend the existing C1 activity e2e (find via
  `grep -rl "activities\|albumId.*activity\|hasDirectAccess\|ReactionLevel" e2e/src`)

- [ ] **Step 1: Write failing unit test** in `activity.service.spec.ts`: for a **space-only** reader
      (`hasDirectAlbumReadAccess` mocked false, no `sharedLink`), `getAll` returns asset-level activity whose
      `user.email === ''` (and `user.name` present, id present). Positive control: a **direct** reader
      (`hasDirectAlbumReadAccess` true) → `user.email` is the real email. Cover both a comment and a like
      (both go through `mapUser`).

- [ ] **Step 2: Run — expect RED.** `cd server && pnpm test -- --run src/services/activity.service.spec.ts`.
      Expected: FAIL — the space-only reader currently sees the real email.

- [ ] **Step 3: Implement.** Replace `getAll`'s return (`:41`):

```ts
return visible.map((activity) => {
  const dto = mapActivity(activity);
  // Fork RBAC (Slice 5 / M5): a space-only reader (no owner/album-user/shared-link access) must not
  // learn commenter/liker emails — the same PII security-8 stripped from albumUsers, one endpoint
  // over. Redact after mapActivity so mapUser's avatarColor email-fallback is already computed.
  if (!hasDirectAccess) {
    dto.user.email = '';
  }
  return dto;
});
```

- [ ] **Step 4: Run — expect GREEN.** Space-only → `email === ''`; direct → real email.

- [ ] **Step 5: Write the e2e negative** (write; CI runs): extend the C1 activity e2e — a space **Viewer**
      (non-participant) `GET /activities?albumId=A` on a visible asset that has a comment + a like → assert
      every `body[i].user.email === ''` (and `user.name`/`id` present). Positive control: an album
      **participant** (owner or album_user) → real `user.email`.

- [ ] **Step 6: tsc + lint, then commit.**

```bash
git add server/src/services/activity.service.ts server/src/services/activity.service.spec.ts e2e/src
git commit -m "fix(spaces): redact commenter emails from asset-level activity for space-only readers (M5)"
```

---

## Edge cases (assert each — spec §Slice 5)

- [ ] Album participant who is also a space member → full email/name (direct access wins).
- [ ] `avatarColor` derived from email → still computed (redact after `mapUser`, not before) — assert
      `user.avatarColor` is non-empty on the redacted entry.
- [ ] Album-level activity (assetId null) for space-only reader → already excluded by C1 (regression).
- [ ] Owner / shared-viewer → full payload (direct access).

## Definition of done

- Unit green; e2e written (CI). tsc + lint clean. No DTO/SDK change. One commit pushed. Scope-clean.
- **This completes Phase 1** (H1, M1, M2, M11, M5 all closed).
