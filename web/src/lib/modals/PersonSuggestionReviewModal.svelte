<script lang="ts">
  import FaceCrop from '$lib/components/faces-page/face-crop.svelte';
  import { getAssetMediaUrl } from '$lib/utils';
  import { getContentMetrics } from '$lib/utils/container-utils';
  import { handleError } from '$lib/utils/handle-error';
  import { getBoundingBox } from '$lib/utils/people-utils';
  import type { Faces } from '$lib/managers/asset-viewer-manager.svelte';
  import {
    AssetMediaSize,
    type PersonFaceSuggestionPageResponseDto,
    type PersonFaceSuggestionResponseDto,
    type PersonResponseDto,
  } from '@immich/sdk';
  import { Button, IconButton, Modal, ModalBody, ModalFooter, toastManager } from '@immich/ui';
  import {
    mdiAccountCheckOutline,
    mdiAccountRemoveOutline,
    mdiChevronLeft,
    mdiChevronRight,
    mdiEyeOffOutline,
  } from '@mdi/js';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  type PageReq = { page: number; size: number };

  // F24: the server states explicitly whether an action endpoint acted or was a no-op — see
  // person.controller.ts / shared-space.controller.ts. The modal reads THIS instead of inferring intent from
  // an error status code (the old `{ status: 400 }` check this replaced conflated the one genuinely benign
  // no-op case with a real authorization failure, which also 400s via requireAccess).
  //
  // S11b: the signal is the response BODY, not the status code. @oazapfts/runtime's ok() resolves to the
  // body and throws away the numeric status for every success code, so the generated SDK cannot surface a
  // 200-vs-204 distinction at all — every action endpoint answers 200 with `{ acted }`.
  type FaceSuggestionActionResult = { acted: boolean };

  interface Props {
    person: PersonResponseDto;
    referenceThumbnailUrl: string;
    loadPage: (req: PageReq) => Promise<PersonFaceSuggestionPageResponseDto>;
    confirm: (assetFaceId: string) => Promise<FaceSuggestionActionResult>;
    dismiss: (assetFaceId: string) => Promise<FaceSuggestionActionResult>;
    ignore: (assetFaceId: string) => Promise<FaceSuggestionActionResult>;
    onClose: (result: { confirmed: number }) => void;
  }

  let { person, referenceThumbnailUrl, loadPage, confirm, dismiss, ignore, onClose }: Props = $props();

  const PAGE_SIZE = 50;
  const PREFETCH = 3;

  // D8: the server drains a face's pending row the instant it's confirmed/dismissed/ignored, so paging by a
  // fixed offset (page 2, page 3, ...) walks a moving target and silently drops however many rows shifted out
  // from under it. The only stable cursor is the HEAD of the list — every fetch below always re-reads page 1.
  // `items` is append-only (acted rows are never spliced out) so back-navigation can still render them,
  // read-only; `actedFaceIds` both drives that read-only state and skips rows this client already resolved
  // but the server hasn't settled yet (the classic just-acted-then-refetched race).
  const actedFaceIds = new SvelteSet<string>();

  let items = $state<PersonFaceSuggestionResponseDto[]>([]);
  let total = $state(0);
  let index = $state(0);
  let loading = $state(true);
  let busy = $state(false);
  let confirmed = $state(0);

  let imgEl = $state<HTMLImageElement | undefined>(undefined);
  let imgReady = $state(false);

  const current = $derived(items[index]);
  const currentActed = $derived(current ? actedFaceIds.has(current.assetFaceId) : false);
  const photoUrl = $derived(current ? getAssetMediaUrl({ id: current.assetId, size: AssetMediaSize.Preview }) : '');
  // S11.6: the queue is empty — either it started that way or reviewing drained it — and the initial load has
  // settled. `onClose` still fires (unchanged, see advance()/onMount below); this only controls what renders
  // in the instant before/around that.
  const allDone = $derived(!loading && !current);

  // `total` is the server's PENDING count — it shrinks as rows are acted on server-side, while `index` walks
  // the append-only `items` buffer and only grows. Rendering `total` directly as the counter denominator makes
  // it possible for the numerator to exceed it mid-session ("74 of 73"). `displayTotal` — pending remaining
  // plus everything this session has already acted on — approximates the original total and is monotonic, so
  // the numerator never outruns it.
  const displayTotal = $derived(total + actedFaceIds.size);

  const highlight = $derived.by(() => {
    if (!current || !imgReady || !imgEl) {
      return undefined;
    }
    return getBoundingBox(
      [
        {
          id: current.assetFaceId,
          imageWidth: current.imageWidth,
          imageHeight: current.imageHeight,
          boundingBoxX1: current.boundingBoxX1,
          boundingBoxX2: current.boundingBoxX2,
          boundingBoxY1: current.boundingBoxY1,
          boundingBoxY2: current.boundingBoxY2,
        } satisfies Faces,
      ],
      getContentMetrics(imgEl),
    )[0];
  });

  // Always page 1: acted rows have drained server-side, so a fresh page-1 read is the only reliable view of
  // what's still pending. Appends rather than replaces — rows already in `items` (acted or not) keep their
  // position, so `index` never gets silently invalidated out from under the user — and only rows that are
  // neither already local nor already acted-on-but-not-yet-settled get added.
  async function fetchHead() {
    const res = await loadPage({ page: 1, size: PAGE_SIZE });
    total = res.total;
    const existingIds = new Set(items.map((it) => it.assetFaceId));
    const newOnes = res.items.filter((it) => !actedFaceIds.has(it.assetFaceId) && !existingIds.has(it.assetFaceId));
    if (newOnes.length > 0) {
      items = [...items, ...newOnes];
    }
  }

  onMount(async () => {
    try {
      await fetchHead();
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_face_suggestions'));
      onClose({ confirmed });
      return;
    } finally {
      loading = false;
    }
    if (items.length === 0) {
      onClose({ confirmed });
    }
  });

  // Close only when a FRESH fetch confirms nothing unacted is left — never on a stale `items.length >= total`,
  // which the server's own shrinking total makes meaningless (D8).
  async function advance() {
    index++;
    if (index >= items.length - PREFETCH) {
      try {
        await fetchHead();
      } catch (error) {
        if (index >= items.length) {
          // Buffer exhausted AND the top-up failed (e.g. a network blip): falling through to the close check
          // below would report a false "complete" while more may still be pending server-side. Back off to
          // the last valid item, surface the error, and let the user retry (re-act or navigate) instead.
          index--;
          handleError(error, $t('errors.unable_to_load_face_suggestions'));
          return;
        }
        /* buffer still has a valid next item — keep going; the close check below won't fire */
      }
    }
    if (index >= items.length) {
      onClose({ confirmed });
    }
  }

  // F24: stop inferring intent from a status code. The one thing the OLD code got dangerously wrong — treating
  // every `{ status: 400 }` as "already resolved" — is gone: EVERY 4xx/5xx now surfaces via handleError, with
  // the face left unacted so it can be retried. The acted/no-op distinction comes from the resolved value on
  // the SUCCESS path only (`acted`), which the server states explicitly in the body.
  async function act(kind: 'confirm' | 'dismiss' | 'ignore') {
    if (busy || !current || currentActed) {
      return;
    }
    busy = true;
    const face = current.assetFaceId;
    try {
      const result =
        kind === 'confirm' ? await confirm(face) : kind === 'dismiss' ? await dismiss(face) : await ignore(face);
      actedFaceIds.add(face);
      busy = false;
      // acted = the call changed something; !acted = no-op (already resolved, feature disabled, ...). Only
      // `confirm` has a counter/toast — dismiss/ignore mark the face acted and advance identically either way.
      if (kind === 'confirm' && result.acted) {
        confirmed++;
        toastManager.primary($t('face_suggestion_confirmed_toast', { values: { count: 1 } }));
      }
      await advance();
    } catch (error) {
      busy = false;
      // A genuine failure (400 auth/ownership, 403, 500, network drop, ...): surface it and leave `current`
      // exactly as it was so the user can retry. No status code is inspected here — the server's success-path
      // `acted` field (handled above) is the ONLY acted/no-op signal now.
      handleError(error, $t('errors.unable_to_process_face_suggestion'));
    }
  }

  const canPrev = $derived(index > 0);
  const canNext = $derived(index < items.length - 1);

  function step(delta: number) {
    if (busy) {
      return;
    }
    const next = index + delta;
    if (next >= 0 && next < items.length) {
      index = next;
    }
  }

  $effect(() => {
    void current?.assetFaceId;
    imgReady = false;
  });

  function onKeydown(event: KeyboardEvent) {
    if (loading) {
      return;
    }
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault();
        void act('confirm');
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        void act('dismiss');
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        void act('ignore');
        break;
      }
      case ']': {
        step(1);
        break;
      }
      case '[': {
        step(-1);
        break;
      }
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<Modal
  title={person.name
    ? $t('face_suggestion_modal_title', { values: { name: person.name } })
    : $t('face_suggestion_modal_title_unnamed')}
  size="large"
  onClose={() => onClose({ confirmed })}
>
  <ModalBody>
    <div class="min-h-96">
      {#if loading}
        <div data-testid="suggestion-loading" class="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"></div>
      {:else if current}
        <div class="flex flex-col gap-4">
          <p
            data-testid="suggestion-progress"
            data-current={index + 1}
            data-total={displayTotal}
            aria-live="polite"
            class="text-center text-sm text-gray-500 dark:text-gray-400"
          >
            {$t('face_suggestion_progress', { values: { current: index + 1, total: displayTotal } })}
          </p>

          {#if currentActed}
            <p
              data-testid="suggestion-reviewed-badge"
              class="text-center text-xs font-semibold text-green-600 dark:text-green-400"
            >
              {$t('face_suggestion_reviewed')}
            </p>
          {/if}

          <!--
            The stacked footer costs ~100px on a phone; capping the context photo lower there keeps it, both
            face crops and the buttons on screen together, which is the whole comparison the user is making.
          -->
          <div class="relative mx-auto max-h-[40vh] sm:max-h-[60vh]">
            <img
              bind:this={imgEl}
              data-testid="suggestion-full-photo"
              src={photoUrl}
              alt={$t('face_suggestion_candidate')}
              class="max-h-[40vh] w-auto rounded-lg object-contain sm:max-h-[60vh]"
              onload={() => (imgReady = true)}
            />
            {#if highlight}
              <svg class="pointer-events-none absolute inset-0 size-full">
                <defs>
                  <mask id="suggestion-dim-mask">
                    <rect width="100%" height="100%" fill="white" />
                    <rect
                      x={highlight.left}
                      y={highlight.top}
                      width={highlight.width}
                      height={highlight.height}
                      rx="8"
                      fill="black"
                    />
                  </mask>
                </defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,0.55)" mask="url(#suggestion-dim-mask)" />
              </svg>
              <div
                data-testid="suggestion-highlight"
                class="pointer-events-none absolute rounded-lg border-3 border-solid border-white"
                style="top: {highlight.top}px; left: {highlight.left}px; width: {highlight.width}px; height: {highlight.height}px;"
              ></div>
            {:else}
              <div data-testid="suggestion-highlight-placeholder" class="hidden"></div>
            {/if}
          </div>

          <div class="mx-auto flex items-end gap-6">
            <div class="flex flex-col items-center gap-1">
              <img
                data-testid="suggestion-reference"
                src={referenceThumbnailUrl}
                alt={$t('face_suggestion_reference')}
                class="size-24 rounded-lg object-cover"
              />
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_reference')}</span>
            </div>
            <div class="flex flex-col items-center gap-1">
              <div class="size-24">
                <FaceCrop face={current} label={$t('face_suggestion_candidate')} />
              </div>
              <span class="text-xs text-gray-500 dark:text-gray-400">{$t('face_suggestion_candidate')}</span>
            </div>
          </div>
        </div>
      {:else if allDone}
        <div data-testid="suggestion-all-done" class="flex h-96 flex-col items-center justify-center gap-2">
          <p class="text-center text-sm text-gray-500 dark:text-gray-400">{$t('face_suggestion_all_done')}</p>
        </div>
      {/if}
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full items-center justify-between gap-2 sm:gap-3">
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronLeft}
        aria-label={$t('previous')}
        disabled={busy || !canPrev}
        data-testid="suggestion-prev-btn"
        onclick={() => step(-1)}
      />
      <!--
        A single non-wrapping row of three labelled pills does not fit a phone, and the modal's @immich/ui Card
        is `overflow-hidden` — so the overflow CLIPPED the trailing (primary) button rather than scrolling it.
        Below `sm` the verdicts therefore stack full-width in the space between the two chevrons; from `sm` up
        `grow-0` + `flex-row` restores the original centred row exactly.
      -->
      <div
        data-testid="suggestion-actions"
        class="flex min-w-0 grow flex-col gap-2 sm:grow-0 sm:flex-row sm:justify-center sm:gap-3"
      >
        <Button
          class="w-full sm:w-auto"
          shape="round"
          color="secondary"
          disabled={busy || !current || currentActed}
          leadingIcon={mdiAccountRemoveOutline}
          data-testid="suggestion-different-btn"
          onclick={() => act('dismiss')}
        >
          {$t('face_suggestion_different')}
        </Button>
        <Button
          class="w-full sm:w-auto"
          shape="round"
          color="secondary"
          disabled={busy || !current || currentActed}
          leadingIcon={mdiEyeOffOutline}
          data-testid="suggestion-ignore-btn"
          onclick={() => act('ignore')}
        >
          {$t('face_suggestion_ignore')}
        </Button>
        <Button
          class="w-full sm:w-auto"
          shape="round"
          disabled={busy || !current || currentActed}
          leadingIcon={mdiAccountCheckOutline}
          data-testid="suggestion-same-btn"
          onclick={() => act('confirm')}
        >
          {$t('face_suggestion_same')}
        </Button>
      </div>
      <IconButton
        variant="ghost"
        shape="round"
        icon={mdiChevronRight}
        aria-label={$t('next')}
        disabled={busy || !canNext}
        data-testid="suggestion-next-btn"
        onclick={() => step(1)}
      />
    </div>
  </ModalFooter>
</Modal>
