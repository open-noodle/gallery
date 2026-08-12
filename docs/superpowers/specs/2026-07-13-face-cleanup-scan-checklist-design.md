# Face Cleanup — post-scan "What to do now" checklist — design

**Status:** approved (brainstorm 2026-07-13). Implement on `feat/face-cleanup-consistency` (PR #773).

**Origin:** the first screen after a scan is overwhelming and gives no guidance. It presents, in order: a
three-line description paragraph, five stat cards, four filter chips, a search box, a bulk-selection bar and a
grouped table — before the admin has been told what any of it is for, or what they are supposed to do next. The
"Review these first" vs "Confident" split is the heart of the workflow and is explained nowhere.

Worse, the riskiest fact on the page is silent: **the confident clusters are pre-selected**, so the most
prominent button on the screen ("Re-attribute selected (90)") re-attributes 90 people in one click. Nothing
tells the admin that, or why the review-first ones are excluded from it.

---

## 1. What it is

A **live checklist** at the top of the console — not a static explainer. It reads the real scan state, so it
doubles as a progress indicator and answers "what is left for me to do?", the question the page cannot currently
answer.

It **replaces the description paragraph** (`face_cleanup_description`), whose gist survives as a one-line
subtitle. The page therefore gains guidance without gaining height — it is already dense.

```
What to do now — Re-home impostor faces to their true owners. Real faces, names and thumbnails are preserved.

  ① Open the 16 that need a decision            3 of 16 opened      [Review first →]
    The scan isn't confident about these: named, large, or routing into another flagged
    cluster. They stay out of the bulk selection until you open them.

  ② 90 confident clusters are already selected
    Single clean owner, unnamed. Ticking a review-first person you've opened adds it here too.

  ③ Re-attribute selected (90)
    Moves only the flagged faces. Each person keeps every real face, its name and its thumbnail.
```

## 2. Why the progress is free

`face-cleanup.svelte.ts` already gates selection on an `opened` set: a review-first person is only selectable
once the admin has opened it (`canSelect`), and that set is persisted per-scan in sessionStorage and carried
across refetches. And a person **drains from the scan** once reviewed or dismissed. So "3 of 16 opened" and
"16 left" are both existing state — the checklist displays it rather than tracking anything new.

## 3. States

| Condition                                 | Rendering                                                             |
| ----------------------------------------- | --------------------------------------------------------------------- |
| No scan yet / scan found nothing          | Not rendered — the existing empty states already speak for themselves |
| `reviewFirstTotal > 0`, some unopened     | ① active, showing `opened of total`                                   |
| every review-first opened (or none exist) | ① collapses to a green ✓ done line                                    |
| `confidentTotal === 0`                    | ② dimmed, "none in this scan" — nothing was auto-selected             |
| `selectedCount === 0`                     | ③ dimmed — there is nothing to commit                                 |

Step ①'s button flips the **existing** filter chip to `review-first`. It is a shortcut into machinery that is
already there, not a new mechanism.

## 4. Code

- **New** `web/src/routes/admin/face-cleanup/ScanChecklist.svelte`. Pure presentation, props only:
  `{ reviewFirstTotal, reviewFirstOpened, confidentTotal, selectedCount, onReviewFirst }`. It fetches nothing and
  mutates no model — the page owns all state, as it already does.
- **Edited** `+page.svelte`: renders the checklist in place of the description paragraph, passes the counts off
  the existing view model (`vm.reviewFirst`, `vm.confident`, `vm.opened`, `vm.selectedCount`), and wires
  `onReviewFirst` to `filter = 'review-first'`.
- No server, SDK, or schema change.

## 5. i18n

New `admin.face_cleanup_steps_*` keys in `i18n/en.json` (English only; other locales fall back and Weblate
fills them): `_title`, `_subtitle`, `_review_title` / `_review_body` / `_review_progress` / `_review_cta` /
`_review_done`, `_confident_title` / `_confident_body` / `_confident_none`, `_apply_title` / `_apply_body`.
The now-unused `face_cleanup_description` key is removed (checked against web **and** mobile — the `i18n/`
directory is shared).

## 6. Tests

- `ScanChecklist.spec.ts` — the state matrix of §3: counts render; ① completes at zero-remaining; ② dims with no
  confident clusters; ③ dims on an empty selection; the CTA fires `onReviewFirst`.
- `face-cleanup.spec.ts` (page) — the checklist renders after a scan with its real counts, and its CTA filters
  the table to review-first.
