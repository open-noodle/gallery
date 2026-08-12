# Slice 11b — Replace the 200/204 action contract with an `{ acted }` body

**Spec:** [`2026-07-30-face-review-unification-remediation-slices.md`](../specs/2026-07-30-face-review-unification-remediation-slices.md)
(follow-up to Slice 11, finding F24)

## Why this slice exists

Slice 11 made the four suggestion actions report whether they acted, and had the controllers map
that to **200 (acted)** vs **204 (no-op)**. The server half is correct and tested. The client half
cannot work:

`@oazapfts/runtime`'s `ok()` resolves to the **response body** and discards the numeric status for
every 2xx. A generated SDK caller therefore structurally cannot tell 200 from 204. Regenerating the
SDK does not fix this — it is a property of the runtime, not of the spec. Slice 11 shipped a
commented interim adapter (`toActionResult`) at both call sites that treats any non-throwing call as
"acted", so a genuine no-op is currently reported as an action.

**The fix is a contract change, not a regeneration.** Move the signal out of the status code and
into the body: always **200**, with `{ acted: boolean }`. oazapfts expresses that trivially.

The dangerous half of F24 — a real failure reported as success — was already fixed in Slice 11 and
must stay fixed: every 4xx/5xx still surfaces through `handleError` with the face left retryable.

## Scope

Eight endpoints, all currently `@HttpCode(HttpStatus.OK)` + `@Res({ passthrough: true })`:

| Controller                   | Endpoints                                       |
| ---------------------------- | ----------------------------------------------- |
| `person.controller.ts`       | confirm, reject, ignore, dismiss                |
| `shared-space.controller.ts` | confirm, reject, ignore, dismiss (space person) |

The services already return `Promise<boolean>` — **no service change is needed**. This slice changes
the controllers, adds one DTO, updates the specs, and then removes the two web adapters.

## Part 1 — the DTO

`server/src/dtos/person.dto.ts`, beside the other suggestion schemas:

```ts
const FaceSuggestionActionResponseSchema = z
  .object({
    // F24: the acted/no-op signal lives in the BODY, not the status code. oazapfts' ok() resolves to
    // the body and discards the status for every 2xx, so a 200-vs-204 contract is unreadable by any
    // generated client. Both controllers return 200 with this shape.
    acted: z.boolean().describe('Whether the call changed anything. False when the suggestion was already resolved.'),
  })
  .meta({ id: 'FaceSuggestionActionResponseDto' });

export class FaceSuggestionActionResponseDto extends createZodDto(FaceSuggestionActionResponseSchema) {}
```

`shared-space.controller.ts` already imports suggestion DTOs from `src/dtos/person.dto`, so one
definition serves both.

## Part 2 — the controllers

For each of the eight handlers: drop the `@Res({ passthrough: true }) res: Response` parameter and
the `res.status(...)` line, keep `@HttpCode(HttpStatus.OK)`, and return the DTO shape.

```ts
  async confirmPersonFaceSuggestion(
    @Auth() auth: AuthDto,
    @Param() { id, assetFaceId }: PersonFaceSuggestionParamsDto,
  ): Promise<FaceSuggestionActionResponseDto> {
    return { acted: await this.service.confirmFaceSuggestion(auth, id, assetFaceId) };
  }
```

Update each `@Endpoint({ description })`: replace "204 if there was nothing to do." with
"Idempotent — the response reports whether it acted." Remove the now-stale `Response` import from
both controllers if nothing else uses it.

## Part 3 — the web modal

`web/src/lib/modals/PersonSuggestionReviewModal.svelte`:

- `type FaceSuggestionActionResult = { acted: boolean };`
- the success branch becomes `if (kind === 'confirm' && result.acted)`.
- Keep the catch block exactly as it is — it is the fixed half of F24.
- Update the comments so they describe the body contract, not 200/204.

## Part 4 — remove both interim adapters

1. **`toActionResult`** in
   `web/src/routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte` and
   `web/src/routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`.
   Delete the helper and its comment; pass the SDK calls straight through — after regeneration they
   resolve to `{ acted: boolean }`.
2. **The resolutions de-dup workaround** in `web/src/routes/admin/face-cleanup/resolutions/+page.svelte`.
   The regenerated SDK now accepts `getFaceRepairResolutions({ page, size })` and the DTO carries
   `total`. Replace the "re-request the default page and filter by id" block with real paging: track
   `page`, request `page + 1` on Load more, append, and drop the `as unknown as` cast.

## Tests (write first — each must be seen RED for the stated reason)

| #      | Layer | Test                                                                                                  |
| ------ | ----- | ----------------------------------------------------------------------------------------------------- |
| S11b.1 | unit  | `person.controller`: confirm returns **200** and body `{ acted: true }` when the service acted        |
| S11b.2 | unit  | `person.controller`: confirm returns **200** and body `{ acted: false }` on a no-op — and **not** 204 |
| S11b.3 | unit  | the same two cases for reject, ignore and dismiss                                                     |
| S11b.4 | unit  | `shared-space.controller`: the same acted/no-op body for all four space-person actions                |
| S11b.5 | web   | modal: `{ acted: true }` from confirm ⇒ counter incremented and success toast shown                   |
| S11b.6 | web   | modal: `{ acted: false }` ⇒ face acted and modal advances, but counter **not** incremented, no toast  |
| S11b.7 | web   | **pin** — a rejected call still calls `handleError`, leaves the face unacted and does not advance     |
| S11b.8 | web   | resolutions: Load more requests **page 2** (not page 1 again) and appends its rows                    |
| S11b.9 | web   | resolutions: the rendered total comes from the server's `total`, not `resolutions.length`             |

S11b.2 is the load-bearing one: it is the test that would have caught the un-shippable contract.

## Verification

```bash
cd server && pnpm exec vitest --config test/vitest.config.mjs --run \
  src/controllers/person.controller.spec.ts src/controllers/shared-space.controller.spec.ts
cd web && pnpm exec vitest --run \
  src/lib/modals/PersonSuggestionReviewModal.spec.ts \
  src/routes/admin/face-cleanup/resolutions/page.spec.ts
cd server && pnpm exec tsc --noEmit -p tsconfig.json
cd web && pnpm check:typescript
```

Then the regeneration pass (server build → sync-open-api → oazapfts → Dart), because the response
schema of eight endpoints changed. Run it with explicit cwd inside the worktree — `mise //:` can
resolve to the parent checkout.

## Constraints

- Pass explicit spec paths, never globs — a vitest glob over bracketed route dirs matches zero files
  and reports a clean pass.
- `vitest` does not typecheck. Run tsc separately.
- No `Co-Authored-By` / "Generated with" trailers.

## Commit

```
fix(api): report face-review action outcomes in the body, not the status code
```
