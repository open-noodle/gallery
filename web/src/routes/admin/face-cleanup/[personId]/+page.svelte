<script lang="ts">
  import AdminPageLayout from '$lib/components/layouts/AdminPageLayout.svelte';
  import { Route } from '$lib/route';
  import { getAdminFaceThumbnailUrl } from '$lib/utils/people-utils';
  import {
    getFaceRepairClusterFaces,
    getFaceRepairPersonFaces,
    getLatestScan,
    getPeopleThumbnailPath,
    isHttpError,
    resolveFaces,
    type FaceRepairResolveRequestDto,
  } from '@immich/sdk';
  import { Button, ConfirmModal, Icon, modalManager, toastManager } from '@immich/ui';
  import { mdiArrowLeft, mdiArrowRight, mdiCheckBold, mdiClose, mdiInformationOutline } from '@mdi/js';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t, type Translations } from 'svelte-i18n';
  import { getServerErrorMessage, handleError } from '$lib/utils/handle-error';
  import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
  import FacePhotoModal from '$lib/components/face-cleanup/FacePhotoModal.svelte';
  import FaceReviewDock from '$lib/components/face-cleanup/FaceReviewDock.svelte';
  import FaceTileOverlay from '$lib/components/face-cleanup/FaceTileOverlay.svelte';
  import type { FaceActionId } from '$lib/components/face-cleanup/face-actions';
  import type { FacePhotoFace } from '$lib/components/face-cleanup/face-photo';
  import { faceCleanupBreadcrumbs, guidedCrumb } from '../breadcrumbs';
  import type { PageData } from './$types';
  import { selectableDestinations, sortDestinations, type SuspectedOwner } from './destination';
  import DestinationCards from './DestinationCards.svelte';
  import DestinationSelect from './DestinationSelect.svelte';
  import PersonPicker from './PersonPicker.svelte';
  import {
    createReviewModel,
    STATE_COLOR,
    STATE_ICON,
    type FaceEntry,
    type FaceState,
    type FlaggedFace,
  } from './review.svelte';

  interface ScanPerson {
    personId: string;
    ownerId: string;
    personName: string | null;
    faceCount: number;
    thumbnailFaceId: string | null;
    eligible: number;
    flagged: number;
    flaggedFraction: number;
    suspectedOwners: SuspectedOwner[];
    recommendation: 'confident' | 'review-first';
    reviewReasons: string[];
  }

  interface FaceCleanupScan {
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: { scanned: number; total: number } | null;
    totals: object | null;
    persons: ScanPerson[];
    error: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }

  type Props = { data: PageData };
  const { data }: Props = $props();

  const personId = $derived(data.personId);

  // State
  let flaggedFaces = $state<FlaggedFace[]>([]);
  let scanPerson = $state<ScanPerson | null>(null);
  let loading = $state(true);
  let loadError = $state(false);
  let applying = $state(false);
  let applyError = $state<string | null>(null);

  // Rest-of-cluster (server-paginated, add-faces feature): faces the scan never flagged, which the admin can add
  // to the move. This selection STAGES into the dock's single Apply — it does not commit on its own. It used to
  // fire its own independent resolve, which settled none of the flagged snapshot yet still closed the person out
  // of the console, silently discarding every staged flagged decision (they came back on the next scan). The
  // server now refuses to drain on such a resolve; the client no longer makes one. "Move entire cluster" stays a
  // separate, explicit commit — it moves ALL eligible faces, flagged ones included.
  const REST_PAGE_SIZE = 48;
  let restFaces = $state<FacePhotoFace[]>([]);
  let restTotal = $state(0);
  let restPage = $state(0);
  let restHasMore = $state(false);
  let restLoading = $state(false);
  // F25: a failed rest-of-cluster load used to be swallowed silently (`catch { /* graceful */ }`), leaving
  // `restTotal` at whatever it was before the failed call (0 on the very first load) while the flagged grid
  // rendered normally — "Move entire cluster" would then confirm moving a count far smaller than the real
  // cluster. Tracked explicitly so the whole-cluster action can be disabled while it is true.
  let restLoadError = $state(false);
  const restSelected = new SvelteSet<string>();

  // An entire-cluster move covers ALL eligible faces: the Rest (which excludes the flagged ids) plus the
  // still-flagged faces. This is why "Move entire cluster" works even when the Rest is empty.
  const clusterTotal = $derived(restTotal + flaggedFaces.length);

  // Lazy-load chunk size for the flagged grid — selection/Apply always act on the full flagged set (via the
  // review model), independent of how much is currently rendered.
  const CHUNK_SIZE = 48;
  // Cap on the RAW (untranslatable) server text rendered in the apply banner — see commitResolve.
  const MAX_ERROR_REASON_LENGTH = 300;
  // Contract with FaceRepairResolveErrorCode in face-repair.service.ts. These are the resolve failures an admin
  // can actually hit, so they get real translated sentences rather than the server's English developer text.
  // Typed `Translations`, not `string`: `$t` only accepts keys that exist in en.json, so a typo here is a build
  // error rather than a banner that renders a raw key at an admin.
  const REASON_KEY_BY_CODE: Record<string, Translations> = {
    'face-repair:person-not-found': 'admin.face_cleanup_review_apply_reason_person_gone',
    'face-repair:destination-missing': 'admin.face_cleanup_review_apply_reason_destination_gone',
    'face-repair:faces-not-in-snapshot': 'admin.face_cleanup_review_apply_reason_stale',
    'face-repair:faces-not-eligible': 'admin.face_cleanup_review_apply_reason_stale',
  };
  let visibleCount = $state(CHUNK_SIZE);

  // View model (Model B / full resolution)
  let vm = $derived(createReviewModel(flaggedFaces));

  // Derived person metadata
  // Trim-checked, not `??`: an empty or whitespace-only name must not render as a blank breadcrumb crumb or
  // a blank heading. Matches people/[personId]/+page.svelte, which has guarded this since it shipped.
  const personName = $derived(
    scanPerson?.personName?.trim() ? scanPerson.personName : $t('admin.face_cleanup_review_unnamed'),
  );
  const faceCount = $derived(scanPerson?.faceCount ?? 0);
  const destinations = $derived(sortDestinations(scanPerson?.suspectedOwners ?? []));
  const selectable = $derived(selectableDestinations(destinations));
  // Retained for the tile ribbons and the tally, which name a face's OWN destination; no longer the page's
  // single source of truth for where anything goes.
  const primaryOwner = $derived(selectable[0] ?? null);
  const ownerName = $derived(primaryOwner?.ownerName ?? $t('admin.face_cleanup_review_unnamed'));
  const ownerPersonId = $derived(primaryOwner?.ownerPersonId ?? null);

  // The destination for the two whole-cluster actions. Defaults to the largest SURVIVING suggestion — a
  // deleted one would enable both buttons only to fail at Apply.
  let chosenDestinationId = $state<string | null>(null);
  let chosenDestinationName = $state<string | null>(null);

  const destinationId = $derived(chosenDestinationId ?? selectable[0]?.ownerPersonId ?? null);
  const destinationName = $derived(
    chosenDestinationName ??
      selectable.find((o) => o.ownerPersonId === destinationId)?.ownerName ??
      $t('admin.face_cleanup_review_unnamed'),
  );
  // Moving a cluster into itself would move every face onto the person it already sits on and then delete the
  // "empty" original. Scan suggestions can never be this cluster (the engine skips it), but the picker
  // searches the whole library, so the guard lives on the action.
  const isSelfDestination = $derived(destinationId === personId);
  // Distinct from isSelfDestination: no suggestion survived at all (an orphan cluster, or every suggestion
  // ownerMissing) — the two need their own explanations, since "pick a different destination" is nonsensical
  // when there is no destination to begin with.
  const noDestination = $derived(!destinationId);
  const canBulkMove = $derived(!!destinationId && !isSelfDestination);
  // F25: "Move entire cluster" additionally requires a successful rest-of-cluster load — the confirmation
  // names `clusterTotal` (restTotal + flaggedFaces.length), and a failed load leaves `restTotal` understating
  // the real cluster by however many faces failed to load. Scoped to this one action only: select-all and
  // per-tile staging are unaffected (restFaces is empty on a failed load regardless, so there is nothing to
  // stage from it either way).
  const canMoveEntireCluster = $derived(canBulkMove && !restLoadError);
  // Staged rest faces are KEPT even once their destination stops being usable — discarding a page of
  // deliberate selection over a dropdown mis-click (e.g. accidentally picking the reviewed cluster itself in
  // "Choose someone else…") was considered and rejected: a mis-click must not destroy real work. Apply is
  // blocked instead, until the admin resolves the mismatch by picking a valid destination (one action) or
  // unticking every staged face — there is no deselect-all, so that is one click per face — and both remain
  // available (see the rest-tile's onclick below).
  const restBlocked = $derived(!canBulkMove && restSelected.size > 0);

  const visibleFaces = $derived(vm.faces.slice(0, visibleCount));
  const hasMore = $derived(visibleCount < vm.faces.length);

  // Admin cleanup/resolutions render clusters the admin does not own, and a negative-verdict face has no
  // person↔face join at all — the person-scoped thumbnail routes 404/403 for those. Face-keyed, admin-gated,
  // no join required.
  const personThumbUrl = (id: string, thumbnailFaceId: string | null) =>
    thumbnailFaceId ? getAdminFaceThumbnailUrl(thumbnailFaceId) : `/api${getPeopleThumbnailPath(id)}`;
  const faceThumbnailUrl = (faceId: string) => getAdminFaceThumbnailUrl(faceId);

  const ownerNameById = (ownerPersonId: string): string =>
    scanPerson?.suspectedOwners?.find((o) => o.ownerPersonId === ownerPersonId)?.ownerName ??
    $t('admin.face_cleanup_review_unnamed');

  const ribbonLabel = (face: FaceEntry): string => {
    switch (face.state) {
      case 'owner': {
        return $t('admin.face_cleanup_review_tile_dest', { values: { name: ownerNameById(face.suspectedOwnerId) } });
      }
      case 'other': {
        return $t('admin.face_cleanup_review_tile_dest', { values: { name: face.destinationName ?? '' } });
      }
      case 'stay': {
        return $t('admin.face_cleanup_review_tile_stay_ribbon');
      }
      case 'lock': {
        return $t('admin.face_cleanup_review_tile_lock_ribbon');
      }
      case 'detach': {
        return $t('admin.face_cleanup_review_tile_detach_ribbon');
      }
      case 'unknown': {
        return $t('admin.face_cleanup_review_tile_unknown_ribbon');
      }
    }
  };

  const loadPersonData = async () => {
    loading = true;
    loadError = false;
    try {
      const [facesResult, scanResult] = await Promise.all([getFaceRepairPersonFaces({ personId }), getLatestScan()]);

      const faces = facesResult as unknown as { flaggedFaces: FlaggedFace[] };
      flaggedFaces = faces?.flaggedFaces ?? [];

      const scan = scanResult as unknown as FaceCleanupScan | null;
      if (scan?.persons) {
        scanPerson = scan.persons.find((p) => p.personId === personId) ?? null;
      }

      if (flaggedFaces.length > 0) {
        void loadRestPage();
      }
    } catch (error) {
      // D17: a failed load is not the same as "this person has no flagged faces" (a genuine, graceful empty
      // state below) — render a distinct error state with a Retry instead.
      loadError = true;
      handleError(error, $t('admin.face_cleanup_review_load_error'));
    } finally {
      loading = false;
    }
  };

  onMount(loadPersonData);

  const handleLoadMore = () => {
    visibleCount = Math.min(visibleCount + CHUNK_SIZE, vm.faces.length);
  };

  const handleTileClick = (assetFaceId: string, event: MouseEvent) => {
    if (event.shiftKey) {
      vm.selectRange(assetFaceId);
    } else {
      vm.toggleSelect(assetFaceId);
    }
  };

  // #1061: opens the source photo behind a face crop. `faces` is whichever grid's array the magnifier was
  // clicked from — the modal only knows the faces LOADED in that grid (both paginate), so it never claims a
  // cycle over the whole cluster.
  const openPhoto = (faces: FacePhotoFace[], index: number) => {
    void modalManager.show(FacePhotoModal, { faces, index });
  };

  // The six guided routes, in bar order. `owner` gains a testid it never had — every other id is preserved
  // exactly, because e2e targets these rather than the labels.
  const GUIDED_DOCK_ACTIONS = [
    { id: 'owner', testId: 'bulk-owner' },
    { id: 'stay', testId: 'bulk-stay' },
    { id: 'lock', testId: 'bulk-lock' },
    { id: 'other', testId: 'bulk-other' },
    { id: 'unknown', testId: 'bulk-unknown' },
    { id: 'detach', testId: 'bulk-detach' },
  ] as const satisfies readonly { id: FaceActionId; testId: string }[];

  // `other` is the only route that opens a picker first; the rest stamp the selection straight away.
  const handleDockAction = (id: FaceActionId) => {
    if (id === 'other') {
      void handleBulkOther();
      return;
    }
    vm.applyToSelection(id as Exclude<FaceActionId, 'other' | 'keep' | 'unmark'>);
  };

  // The six bulk actions carry terse labels and no explanation of what they do on apply. Two entry points open
  // the same modal: the banner (always visible, so a confused admin finds it BEFORE selecting anything) and the
  // bulk bar (which only exists once a face is selected, i.e. mid-task). Read-only — it never touches the
  // review model, so an open/close leaves the selection and the staged states exactly as they were.
  const handleOpenHelp = () => {
    void modalManager.show(FaceActionsHelpModal, {
      mode: 'guided',
      actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
      introKey: 'admin.face_cleanup_review_help_intro',
      footerKey: 'admin.face_cleanup_review_help_footer',
    });
  };

  const handleBulkOther = async () => {
    if (!scanPerson || vm.selectedCount === 0) {
      return;
    }
    const destination = await modalManager.show(PersonPicker, {
      ownerId: scanPerson.ownerId,
      faceCount: vm.selectedCount,
      suggestedPersonId: ownerPersonId,
    });
    if (destination) {
      vm.applyToSelection('other', destination);
    }
  };

  const loadRestPage = async () => {
    if (restLoading) {
      return;
    }
    restLoading = true;
    // F25: cleared on every attempt (including a Retry) — a fresh success must re-enable the whole-cluster
    // action.
    restLoadError = false;
    try {
      const result = await getFaceRepairClusterFaces({
        personId,
        faceRepairClusterFacesRequestDto: {
          excludeFaceIds: flaggedFaces.map((f) => f.assetFaceId),
          page: restPage,
          size: REST_PAGE_SIZE,
        },
      });
      restFaces = [...restFaces, ...result.faces];
      restTotal = result.total;
      restHasMore = result.hasMore;
      restPage += 1;
    } catch {
      // F25: no longer silently swallowed — restTotal/clusterTotal would otherwise understate the real
      // cluster while "Move entire cluster" stays clickable and names the wrong count.
      restLoadError = true;
    } finally {
      restLoading = false;
    }
  };

  const handleSelectAllRest = () => {
    for (const face of restFaces) {
      restSelected.add(face.assetFaceId);
    }
  };

  const handleMoveEntireCluster = () => {
    if (!canMoveEntireCluster) {
      return;
    }
    void confirmMoveEntireCluster();
  };

  // Uses `modalManager.show(ConfirmModal, …)` (@immich/ui) rather than a hand-rolled overlay: it comes with
  // `role="dialog"`, `aria-modal`, a focus trap, Escape-to-cancel and backdrop dismissal for free — none of
  // which the previous inline `fixed inset-0` div had.
  const confirmMoveEntireCluster = async () => {
    if (!canMoveEntireCluster || !destinationId) {
      return;
    }
    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('admin.face_cleanup_review_move_entire_confirm_title'),
      prompt: $t('admin.face_cleanup_review_move_entire_confirm_body', {
        values: { count: clusterTotal, owner: destinationName },
      }),
      confirmText: $t('admin.face_cleanup_review_move_entire_confirm_cta', {
        values: { count: clusterTotal },
      }),
    });
    if (!confirmed || !canMoveEntireCluster || !destinationId) {
      return;
    }
    await commitResolve({ personId, entireCluster: { destinationPersonId: destinationId } });
  };

  const handleChooseOtherDestination = async () => {
    // Same guard as handleBulkOther: without scanPerson there is no ownerId to scope the picker to.
    if (!scanPerson) {
      return;
    }
    const chosen = await modalManager.show(PersonPicker, {
      ownerId: scanPerson.ownerId,
      faceCount: clusterTotal,
      suggestedPersonId: selectable[0]?.ownerPersonId ?? null,
      showLock: false,
    });
    // Dismissed — leave the current destination exactly as it was.
    if (!chosen) {
      return;
    }
    chosenDestinationId = chosen.personId;
    chosenDestinationName = chosen.name;
  };

  const handleSelectDestination = (destinationPersonId: string) => {
    // Named to avoid shadowing the module-level `ownerPersonId` derived above (the scan's own suggestion) —
    // this parameter is whatever the admin just picked in the select, which may not be it.
    chosenDestinationId = destinationPersonId;
    chosenDestinationName = null;
  };

  const handleCancel = () => {
    void goto(Route.faceCleanupScan());
  };

  // Every resolve on this page funnels through here, so a failure can never again be swallowed: the whole-cluster
  // move used to `catch {}` the server's 409 ("Refusing to apply while a scan is in progress"), leaving the admin
  // with no banner, nothing moved, and the belief that it had worked — the same faces then came back on the next
  // scan. On success we report what the server actually DID (its own counts) rather than blind-navigating.
  // The fields this page reads off a failed resolve. Deliberately loose: `code` is a fork-only addition and
  // Zod's `maximum` is not in the SDK's `ApiValidationError`, so both are validated at the use site.
  type ApplyErrorData = { code?: unknown; errors?: { code?: unknown; maximum?: unknown }[] };

  const parseErrorData = (data: unknown): ApplyErrorData | undefined => {
    // Errors from endpoints without a return type arrive as an unparsed JSON string (same case handle-error.ts
    // covers) — a raw string would silently read as "no code, no issues" and lose the translation.
    if (typeof data === 'string') {
      try {
        return JSON.parse(data) as ApplyErrorData;
      } catch {
        return undefined;
      }
    }
    return (data ?? undefined) as ApplyErrorData | undefined;
  };

  // Turn a failed resolve into the most translatable sentence we can, in this order:
  //   1. a stable server reason code   → a real, translated explanation of what changed under the page;
  //   2. a Zod `too_big` issue         → a translated "too many faces" with the server's own limit;
  //   3. the server's raw message      → English, but a truthful reason beats a reason-less banner;
  //   4. nothing at all (offline, 502) → the original generic sentence.
  // Only 3 stays untranslated, and it is reachable only through failures the UI cannot itself produce.
  const describeApplyFailure = (error: unknown): string => {
    const data = isHttpError(error) ? parseErrorData(error.data) : undefined;

    const reasonKey = typeof data?.code === 'string' ? REASON_KEY_BY_CODE[data.code] : undefined;
    if (reasonKey) {
      return $t('admin.face_cleanup_review_apply_error_reason', { values: { reason: $t(reasonKey) } });
    }

    const tooBig = data?.errors?.find((issue) => issue?.code === 'too_big');
    if (tooBig && typeof tooBig.maximum === 'number') {
      return $t('admin.face_cleanup_review_apply_error_reason', {
        values: { reason: $t('admin.face_cleanup_review_apply_reason_too_many', { values: { max: tooBig.maximum } }) },
      });
    }

    // Truncated: a per-face validation failure produces ONE issue per offending id, and this page's buckets run
    // to thousands of faces — pasting all of them in would push the banner past the content it warns about.
    const serverMessage = getServerErrorMessage(error)?.toString().slice(0, MAX_ERROR_REASON_LENGTH);
    return serverMessage
      ? $t('admin.face_cleanup_review_apply_error_reason', { values: { reason: serverMessage } })
      : $t('admin.face_cleanup_review_apply_error');
  };

  const commitResolve = async (request: FaceRepairResolveRequestDto) => {
    if (applying) {
      return;
    }
    applying = true;
    applyError = null;
    try {
      const result = await resolveFaces({ faceRepairResolveRequestDto: request });
      toastManager.primary(
        $t('admin.face_cleanup_review_apply_summary', {
          values: {
            moved: result.moved,
            kept: result.declined,
            locked: result.locked,
            detached: result.detached,
            unknown: result.unknown,
            skipped: result.skipped,
          },
        }),
      );
      void goto(Route.faceCleanupScan());
    } catch (error: unknown) {
      const status = (error as { status?: number }).status;
      // 409 is the one failure with a genuine "try again later" remedy, so it keeps its own tailored wording.
      // Everything else used to collapse into one reason-less sentence, which is how a hard, permanent failure
      // (a validation ceiling the payload can never satisfy) read exactly like a transient blip and sent admins
      // into retry loops. Now the banner says why — in the admin's own language wherever the server gave us
      // something stable to translate from.
      applyError = status === 409 ? $t('admin.face_cleanup_review_apply_conflict') : describeApplyFailure(error);
    } finally {
      applying = false;
    }
  };

  // The ONE terminal action: every flagged face's staged state, plus any rest-of-cluster faces the admin ticked,
  // in a single resolve. Splitting these into two resolves is what let a rest-move settle none of the flagged
  // snapshot and still close the person out of the console.
  const buildApplyRequest = () =>
    vm.buildResolveRequest(
      personId,
      canBulkMove && destinationId && restSelected.size > 0
        ? { destinationPersonId: destinationId, faceIds: [...restSelected] }
        : undefined,
    );

  // "Not a face" is the one IRREVERSIBLE action on this page: it retires the detected face for good, and there
  // is no undo for it anywhere in the app (declines and locks have one on the Resolutions page; a detached face
  // does not). It also sits directly next to "Unknown person" in the bulk bar, and the two mean opposite things
  // — bin this crop vs. this is a real person I can't name. A slip between those two buttons destroys real face
  // data, so an Apply carrying any detached face has to be confirmed first. Everything else applies straight
  // through: a confirmation on every Apply would train the admin to click past it, which is how you lose the
  // one warning that matters.
  const handleApply = () => {
    // Belt-and-braces alongside apply-btn's own disabled gate below (same double-guard convention as
    // handleMoveEntireCluster/confirmMoveEntireCluster): staged rest faces are never dropped silently, so
    // Apply must refuse outright rather than quietly building a request that omits them.
    if (restBlocked) {
      return;
    }
    if (vm.tally.detach > 0) {
      void confirmDestructiveApply();
      return;
    }
    return commitResolve(buildApplyRequest());
  };

  // `modalManager.show(ConfirmModal, …)` — see confirmMoveEntireCluster above for why.
  const confirmDestructiveApply = async () => {
    const confirmed = await modalManager.show(ConfirmModal, {
      title: $t('admin.face_cleanup_review_detach_confirm_title', { values: { count: vm.tally.detach } }),
      // No `count` value here: the message doesn't reference it (the title above already states the count),
      // and passing an argument the message never interpolates is exactly F31 item 4's other i18n defect.
      prompt: $t('admin.face_cleanup_review_detach_confirm_body'),
      confirmText: $t('admin.face_cleanup_review_detach_confirm_cta', { values: { count: vm.tally.detach } }),
      confirmColor: 'danger',
    });
    if (!confirmed) {
      return;
    }
    await commitResolve(buildApplyRequest());
  };
</script>

<AdminPageLayout breadcrumbs={faceCleanupBreadcrumbs($t, guidedCrumb($t), { title: personName })}>
  <div class="mx-auto max-w-screen-xl p-6">
    <!-- Back link -->
    <a
      href={Route.faceCleanupScan()}
      class="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    >
      <Icon icon={mdiArrowLeft} size="16" />
      {$t('admin.face_cleanup_mode_guided')}
    </a>

    <!-- Title row -->
    <div class="mb-6 flex items-center gap-4">
      {#if !loading && scanPerson}
        <img
          src={personThumbUrl(personId, scanPerson.thumbnailFaceId)}
          alt=""
          class="size-14 flex-none rounded-2xl bg-gray-100 object-cover dark:bg-gray-700"
        />
      {:else}
        <div class="size-14 flex-none rounded-2xl bg-gray-100 dark:bg-gray-700"></div>
      {/if}
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          {$t('admin.face_cleanup_review_heading', { values: { name: personName } })}
        </h1>
        {#if scanPerson}
          <div class="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <span>{$t('admin.face_cleanup_review_header_flagged', { values: { count: flaggedFaces.length } })}</span>
            <span>·</span>
            <span>{faceCount.toLocaleString()} {$t('admin.face_cleanup_faces')}</span>
            <span>·</span>
            <span class="font-mono text-xs">{personId.slice(0, 8)}</span>
          </div>
        {/if}
      </div>
    </div>

    {#if loading}
      <!-- Loading -->
      <div class="flex items-center justify-center py-20 text-gray-400">
        <span>{$t('loading')}</span>
      </div>
    {:else if loadError}
      <!-- Initial load failed (D17): distinct from "no flagged faces" — a network/server error is not the
           same as a stale/already-resolved cluster, and rendering it as the latter hides the failure. -->
      <div
        class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        data-testid="load-error-banner"
      >
        <span class="flex-1">{$t('admin.face_cleanup_review_load_error')}</span>
        <Button color="secondary" size="small" onclick={loadPersonData} data-testid="load-error-retry">
          {$t('retry')}
        </Button>
      </div>
    {:else if flaggedFaces.length === 0}
      <!-- Stale / no flagged faces -->
      <div class="rounded-2xl border border-dashed border-gray-200 py-20 text-center dark:border-gray-700">
        <div class="text-lg font-medium text-gray-500">{$t('admin.face_cleanup_review_no_flagged')}</div>
        <p class="mt-2 text-sm text-gray-400">{$t('admin.face_cleanup_review_no_flagged_sub')}</p>
        <div class="mt-4">
          <Button color="secondary" onclick={handleCancel}>{$t('admin.face_cleanup_mode_guided')}</Button>
        </div>
      </div>
    {:else}
      <!-- Banner -->
      <div
        class="mb-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/30 dark:bg-amber-900/10"
      >
        <div
          class="flex size-8 flex-none items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="mb-1 text-sm font-semibold">
            {$t('admin.face_cleanup_review_banner_title', { values: { count: flaggedFaces.length } })}
          </h3>
          <div class="mb-3">
            <DestinationCards owners={destinations} />
          </div>
          <p class="text-sm text-gray-600 dark:text-gray-300">
            {$t('admin.face_cleanup_review_banner_body')}
          </p>
        </div>
        <!-- Plain button, not <IconButton>: @immich/ui wraps any titled button in a Tooltip, which needs a
             TooltipProvider from the app root — absent when this page is rendered in isolation. A native title
             gives the same hover hint, and plain buttons are already this page's idiom. -->
        <button
          type="button"
          onclick={handleOpenHelp}
          aria-label={$t('admin.face_cleanup_review_help_open')}
          title={$t('admin.face_cleanup_review_help_open')}
          class="flex-none rounded-full p-1.5 text-amber-600 transition-colors hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/30"
          data-testid="banner-help"
        >
          <Icon icon={mdiInformationOutline} size="18" />
        </button>
      </div>

      <!-- Apply error banner -->
      {#if applyError}
        <div
          class="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400"
        >
          <span class="flex-1">{applyError}</span>
          <button type="button" onclick={() => (applyError = null)} class="flex-none text-red-400 hover:text-red-600">
            <Icon icon={mdiClose} size="16" />
          </button>
        </div>
      {/if}

      <!-- Flagged grid -->
      <div class="mb-5 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700">
        <div class="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div>
            <h3 class="text-sm font-semibold">
              {$t('admin.face_cleanup_review_grid_title', { values: { name: personName } })}
            </h3>
            <p class="text-xs text-gray-400">{$t('admin.face_cleanup_review_grid_hint')}</p>
          </div>
          <div class="flex-1"></div>
          <button
            type="button"
            onclick={() => vm.selectAll()}
            class="text-sm font-semibold text-primary hover:underline"
            data-testid="select-all"
          >
            {$t('admin.face_cleanup_review_select_all_flagged', { values: { count: vm.total } })}
          </button>
          <button
            type="button"
            onclick={() => vm.reset()}
            class="text-sm font-semibold text-gray-400 hover:underline"
            data-testid="reset"
          >
            {$t('admin.face_cleanup_review_reset')}
          </button>
        </div>

        <div
          class="grid grid-cols-4 gap-2.5 bg-gray-50 p-4 sm:grid-cols-6 lg:grid-cols-8 dark:bg-gray-800/50"
          data-testid="flagged-grid"
        >
          {#each visibleFaces as face, tileIndex (face.assetFaceId)}
            {@const selected = vm.isSelected(face.assetFaceId)}
            <div class="relative aspect-square">
              <button
                type="button"
                class={[
                  'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                  selected ? 'border-primary' : 'border-transparent',
                ].join(' ')}
                style={selected ? 'box-shadow: 0 0 0 3px rgba(79,70,229,0.32);' : ''}
                onclick={(event) => handleTileClick(face.assetFaceId, event)}
                data-testid="face-tile"
                data-faceid={face.assetFaceId}
                data-state={face.state}
              >
                <img
                  src={faceThumbnailUrl(face.assetFaceId)}
                  alt=""
                  class="size-full object-cover"
                  style={face.state === 'detach' ? 'filter: grayscale(1) opacity(0.55);' : ''}
                  loading="lazy"
                />
                {#if selected}
                  <div class="absolute inset-0 bg-primary/15"></div>
                {/if}
                <!-- State indicator: its own icon per state, never colour alone (owner/stay/other used to share
                     one check mark, so indigo-vs-violet was all that separated "moved away" from "locked here"). -->
                <div
                  class="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-md border-2 border-white shadow-sm"
                  style="background: {STATE_COLOR[face.state]}"
                  data-state-icon={face.state}
                >
                  <Icon icon={STATE_ICON[face.state]} size="11" color="white" />
                </div>
                <!-- Ribbon: right-aligned and capped short of full width so it never overpaints the date pill
                     (FaceTileOverlay, a sibling of this button) sitting in the bottom-left corner. -->
                <div
                  class="absolute right-0 bottom-0 max-w-[70%] truncate rounded-tl-sm p-1 text-center text-[9.5px] font-bold text-white"
                  style="background: {STATE_COLOR[face.state]}"
                >
                  {ribbonLabel(face)}
                </div>
              </button>
              <FaceTileOverlay localDateTime={face.localDateTime} onOpen={() => openPhoto(visibleFaces, tileIndex)} />
            </div>
          {/each}
        </div>

        {#if hasMore}
          <div class="border-t border-gray-200 px-4 py-3 text-center dark:border-gray-700">
            <button
              type="button"
              onclick={handleLoadMore}
              class="text-sm font-semibold text-primary hover:underline"
              data-testid="load-more"
            >
              {$t('admin.face_cleanup_review_load_more', { values: { count: vm.faces.length - visibleCount } })}
            </button>
          </div>
        {/if}
      </div>

      <!-- Rest of this cluster (paginated, add-faces feature — posts through resolve) -->
      <div
        class="mb-28 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700"
        data-testid="rest-section"
      >
        <div class="flex flex-wrap items-center gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h3 class="text-sm font-semibold">
            {$t('admin.face_cleanup_review_rest_title', { values: { count: restTotal } })}
            {#if canBulkMove}
              <!-- Only shown once there IS a destination to name — an orphan cluster or a self-move used to
                   read "add any that belong to Unnamed cluster"/the reviewed person's own name, naming a
                   destination the admin cannot actually add faces to right now. -->
              <span class="ml-2 font-normal text-gray-400">
                {$t('admin.face_cleanup_review_rest_hint', { values: { owner: destinationName } })}
              </span>
            {/if}
          </h3>
          <div class="flex-1"></div>
          {#if restSelected.size > 0}
            <!-- Staged, not committed: these ride the dock's single Apply along with the flagged faces. -->
            <span class="text-xs font-semibold text-primary" data-testid="rest-staged">
              {$t('admin.face_cleanup_review_rest_staged', { values: { count: restSelected.size } })}
            </span>
          {/if}
          <DestinationSelect
            owners={destinations}
            value={destinationId}
            valueLabel={destinationName}
            onSelect={handleSelectDestination}
            onChooseOther={handleChooseOtherDestination}
            disabled={!scanPerson}
          />
          {#if isSelfDestination}
            <span class="text-xs font-semibold text-red-600 dark:text-red-400" data-testid="destination-self-warning">
              {$t('admin.face_cleanup_review_dest_self')}
            </span>
          {:else if noDestination}
            <span class="text-xs font-semibold text-red-600 dark:text-red-400" data-testid="destination-pick-warning">
              {$t('admin.face_cleanup_review_dest_pick_first')}
            </span>
          {/if}
          <button
            type="button"
            onclick={handleSelectAllRest}
            disabled={!canBulkMove || restFaces.length === 0}
            class="text-sm font-semibold text-primary hover:underline disabled:opacity-40"
            data-testid="select-all-btn"
          >
            {$t('admin.face_cleanup_review_select_all')}
          </button>
          <Button
            color="secondary"
            size="small"
            disabled={!canMoveEntireCluster}
            onclick={handleMoveEntireCluster}
            data-testid="move-entire-btn"
          >
            {$t('admin.face_cleanup_review_move_entire')}
          </Button>
        </div>

        {#if restLoadError}
          <!-- F25: distinct from "rest-empty" below — a load FAILURE, not a genuinely empty cluster. Rendering
               the empty state here would misleadingly imply the cluster has no other faces at all. -->
          <div
            class="flex items-center gap-3 px-4 py-6 text-sm text-red-700 dark:text-red-400"
            data-testid="rest-load-error"
          >
            <span class="flex-1">{$t('admin.face_cleanup_review_rest_load_error')}</span>
            <Button
              color="secondary"
              size="small"
              onclick={() => void loadRestPage()}
              data-testid="rest-load-error-retry"
            >
              {$t('retry')}
            </Button>
          </div>
        {:else if restTotal === 0 && !restLoading}
          <div class="py-12 text-center text-sm text-gray-400" data-testid="rest-empty">
            {$t('admin.face_cleanup_review_rest_empty')}
          </div>
        {:else}
          <div class="grid grid-cols-4 gap-3 bg-gray-50 p-4 sm:grid-cols-6 lg:grid-cols-8 dark:bg-gray-800/50">
            {#each restFaces as face, tileIndex (face.assetFaceId)}
              {@const selected = restSelected.has(face.assetFaceId)}
              {@const blocked = !canBulkMove && !selected}
              <div class="relative aspect-square">
                <button
                  type="button"
                  class={[
                    'absolute inset-0 overflow-hidden rounded-xl border-2 transition-all',
                    selected ? 'border-primary' : 'border-transparent opacity-70 hover:opacity-100',
                    blocked ? 'cursor-not-allowed opacity-30 hover:opacity-30' : '',
                  ].join(' ')}
                  disabled={blocked}
                  onclick={() => {
                    // Deselecting always works — a staged face is never trapped by a destination that later
                    // became unusable (a mis-click into a self-move must not destroy deliberate selection, and
                    // the admin's only way out otherwise would be to pick a new destination first). Only NEW
                    // staging is gated: adding a face onto a destination the whole-cluster actions have
                    // already refused would let the ribbon/dock chip start naming a destination Apply refuses
                    // to use (see canBulkMove/restBlocked below).
                    if (restSelected.has(face.assetFaceId)) {
                      restSelected.delete(face.assetFaceId);
                      return;
                    }
                    if (!canBulkMove) {
                      return;
                    }
                    restSelected.add(face.assetFaceId);
                  }}
                  data-testid="rest-tile"
                  data-faceid={face.assetFaceId}
                  data-selected={selected}
                >
                  <img src={faceThumbnailUrl(face.assetFaceId)} alt="" class="size-full object-cover" loading="lazy" />
                  {#if selected}
                    <div
                      class="absolute top-1.5 left-1.5 flex size-5 items-center justify-center rounded-md border-2 border-white bg-primary shadow-sm"
                    >
                      <Icon icon={mdiCheckBold} size="10" color="white" />
                    </div>
                    <div
                      class="absolute right-0 bottom-0 max-w-[70%] truncate rounded-tl-sm bg-linear-to-t from-black/70 to-transparent px-1.5 pt-3 pb-1 text-[10px] font-semibold text-white"
                    >
                      {canBulkMove
                        ? $t('admin.face_cleanup_review_tile_dest', { values: { name: destinationName } })
                        : $t('admin.face_cleanup_review_tile_dest_pending')}
                    </div>
                  {/if}
                </button>
                <FaceTileOverlay localDateTime={face.localDateTime} onOpen={() => openPhoto(restFaces, tileIndex)} />
              </div>
            {/each}
          </div>
          {#if restHasMore}
            <div class="border-t border-gray-200 px-4 py-3 text-center dark:border-gray-700">
              <button
                type="button"
                onclick={loadRestPage}
                class="text-sm font-semibold text-primary hover:underline"
                data-testid="rest-load-more"
              >
                {$t('admin.face_cleanup_review_load_more', { values: { count: restTotal - restFaces.length } })}
              </button>
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  </div>

  <!-- Dock: swaps between the outcome-tally summary and the bulk action bar (Model B mockup). Rendered through
       AdminPageLayout's `footer` slot, i.e. as a sibling of the scroll area rather than inside it. It used to be
       `sticky bottom-0` within the content, which only pins while there is something to scroll: on a short review
       (a handful of flagged faces) the page doesn't overflow, sticky is inert, and the bar came to rest wherever
       the content happened to end — floating in the middle of the page. As a footer it is pinned at every content
       length, the grid scrolls above it instead of under it, and it still never overlaps the sidebar (which is why
       `fixed` was rejected). The content no longer needs `pb-32` to reserve space for it either. -->
  {#snippet footer()}
    {#if !loading && flaggedFaces.length > 0}
      <FaceReviewDock
        mode="guided"
        selectedCount={vm.selectedCount}
        actions={[...GUIDED_DOCK_ACTIONS]}
        onAction={handleDockAction}
        onHelp={handleOpenHelp}
        onClear={() => vm.clearSelection()}
      >
        {#snippet summary()}
          <div class="flex flex-1 flex-wrap items-center gap-3.5" data-testid="tally">
            {#each ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'] as FaceState[] as state (state)}
              {@const count = vm.tally[state]}
              <span
                class={[
                  'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold dark:border-gray-700 dark:bg-gray-800',
                  count === 0 ? 'opacity-40' : '',
                ].join(' ')}
              >
                <Icon icon={STATE_ICON[state]} size="13" color={STATE_COLOR[state]} />
                <span>{count}</span>
                <span class="font-normal text-gray-500 dark:text-gray-400">
                  {state === 'owner'
                    ? destinations.length > 1
                      ? $t('admin.face_cleanup_review_tally_owner_multi')
                      : $t('admin.face_cleanup_review_tally_owner', { values: { name: ownerName } })
                    : $t(`admin.face_cleanup_review_tally_${state}`)}
                </span>
              </span>
            {/each}
            {#if restSelected.size > 0}
              <!-- Rest-of-cluster faces the admin added: part of the same Apply, so the dock must account for
                   them too — otherwise the count lies about what the button is going to do. -->
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
                data-testid="tally-added"
              >
                <span>+{restSelected.size}</span>
                <span class="font-normal">
                  {canBulkMove
                    ? $t('admin.face_cleanup_review_tally_added', { values: { name: destinationName } })
                    : $t('admin.face_cleanup_review_tally_added_pending')}
                </span>
              </span>
            {/if}
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-green-600">
              <Icon icon={mdiCheckBold} size="13" />
              {$t('admin.face_cleanup_review_tally_all_set')}
            </span>
          </div>
          {#if restBlocked}
            <!-- The disabled button explains itself right next to it, rather than leaving the admin to guess
                 why Apply won't go. -->
            <span class="text-xs font-semibold text-red-600 dark:text-red-400" data-testid="apply-blocked-reason">
              {$t('admin.face_cleanup_review_apply_blocked_reason')}
            </span>
          {/if}
        {/snippet}

        {#snippet apply()}
          <Button color="primary" disabled={applying || restBlocked} onclick={handleApply} data-testid="apply-btn">
            <Icon icon={mdiArrowRight} size="16" />
            {restSelected.size > 0
              ? $t('admin.face_cleanup_review_apply_label_added', {
                  values: { count: vm.total, added: restSelected.size },
                })
              : $t('admin.face_cleanup_review_apply_label', { values: { count: vm.total } })}
          </Button>
        {/snippet}
      </FaceReviewDock>
    {/if}
  {/snippet}
</AdminPageLayout>
