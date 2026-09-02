<script lang="ts">
  import {
    addParticipant,
    createUnion,
    deleteUnion,
    FamilyParticipantKind,
    FamilyParticipantRole,
    getAllPeople,
    getIdentityPerson,
    removeParticipant,
    searchPerson,
    setMyRoot,
    updateGender,
    updateUnion,
    type FamilyIdentityDto,
    type FamilyParticipantDto,
    type FamilyUnionCreateDto,
    type FamilyUnionDto,
    type FamilyUnionStatus,
    type PersonResponseDto,
  } from '@immich/sdk';
  import FamilyUnionEditor, { type FamilyUnionEditorSave } from '$lib/components/family/FamilyUnionEditor.svelte';
  import { handleUpdatePersonBirthDate, updatePersonName } from '$lib/services/person.service';
  import { getFamilyIdentityThumbnailUrl, getPeopleThumbnailUrl } from '$lib/utils';
  import { planFamilyDrop, type FamilyDragKind, type FamilyDropPosition } from '$lib/utils/family-editing';
  import {
    buildPositionedFamilyLayout,
    FAMILY_CARD_HEIGHT,
    FAMILY_CARD_WIDTH,
    type PositionedFamilyUnion,
  } from '$lib/utils/family-layout';
  import { t, type Translations } from 'svelte-i18n';
  import { SvelteSet } from 'svelte/reactivity';

  interface Props {
    unions: FamilyUnionDto[];
    identities: Record<string, FamilyIdentityDto>;
    /** The generation anchor — the viewer's own root when it is a member of this cluster,
     * otherwise the cluster's `rootCandidateId` (D6: layout is computed per viewer, never
     * stored, so there is always some anchor to lay the graph out around). */
    rootId: string;
    /** The viewer's OWN root, or null if they have never nominated themselves. Distinct from
     * `rootId`: on a cluster the viewer isn't part of, the layout still has an anchor but there
     * is nobody in it to mark as "you are here". */
    viewerRootId: string | null;
    /** A6: gates the dashed "+ Add a parent" affordance, the drag/drop zones, the tray and the
     * union editor. A view-only viewer sees none of it at all — not a disabled version of it. */
    canContribute: boolean;
    /** Called after a mutation the canvas cannot apply locally — a tray drop creates an identity
     * whose id only the server knows, so the page reloads the graph rather than guessing it. */
    onGraphChanged?: () => void;
  }

  let { unions, identities, rootId, viewerRootId, canContribute, onGraphChanged }: Props = $props();

  // Slice 11 (D6/E52/E53): the canvas mutates its OWN local copy of the graph so a drop can
  // re-render immediately, without waiting on a full page reload of `+page.ts`'s data. `unions`
  // itself is never mutated — only ever read again if the prop identity changes (a fresh page
  // load), which is why this is a plain `$state` snapshot rather than something kept in sync via
  // an `$effect`.
  // A WRITABLE `$derived`, which is exactly the two behaviours this needs at once: a drop assigns
  // to it directly so the canvas re-renders without waiting on the server, and it re-seeds from the
  // prop whenever `+page.ts` hands over a fresh graph. `invalidateAll()` swaps that prop but does
  // NOT recreate this component, so a plain `$state` snapshot went stale — a face dragged in from
  // the tray only appeared after a manual page reload.
  let workingUnions = $derived(unions);

  const layout = $derived(buildPositionedFamilyLayout(workingUnions, rootId, canContribute));

  // A7: "ended" governs the dashed-amber connector styling — a union that is no longer ongoing.
  // Widowed counts as ended for this purpose even though its relationship TERM stays present
  // tense (D4/E42 — that "husband" doesn't retroactively become "ex-husband" is a wording rule
  // for the label engine, not a claim that the union bar should look current).
  const ENDED_STATUSES = new Set(['separated', 'divorced', 'widowed']);
  const isEnded = (status: string) => ENDED_STATUSES.has(status);

  const STATUS_KEYS: Record<string, string> = {
    married: 'family_canvas_union_status_married',
    partnered: 'family_canvas_union_status_partnered',
    separated: 'family_canvas_union_status_separated',
    divorced: 'family_canvas_union_status_divorced',
    widowed: 'family_canvas_union_status_widowed',
  };
  const statusKey = (status: string) => (STATUS_KEYS[status] ?? status) as Translations;

  const toYear = (date: string | null) => (date ? date.slice(0, 4) : null);

  const unionText = (union: PositionedFamilyUnion) => {
    const startYear = toYear(union.startDate);
    const endYear = toYear(union.endDate);
    const status = $t(statusKey(union.status));
    if (startYear && endYear) {
      return `${startYear} – ${endYear} · ${status}`;
    }
    return startYear ? `${status} ${startYear}` : status;
  };

  const initials = (name: string | undefined) =>
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

  // The card's TITLE is the person's name; the derived relation ("your aunt") is the grey
  // sub-line beneath it. Never the other way round, and never one standing in for the other —
  // a canvas of nothing but "your parent" / "your partner" is unreadable the moment two people
  // share a relation, and the label is null anyway for anyone the viewer has no path to (E36).
  // Plenty of recognised people have no name yet. Falling through to an empty string left those
  // cards showing a relation and nothing else — a face with no title at all.
  const displayName = (identityId: string) => identities[identityId]?.name || $t('family_person_anonymous_name');
  const relationLabel = (identityId: string) => identities[identityId]?.label ?? null;

  // A thumbnail that 404s (an identity with no face crop yet) falls back to the initials already
  // painted underneath, rather than a broken-image glyph.
  const brokenThumbnails = new SvelteSet<string>();

  // ── Pan and zoom (slice 10) ────────────────────────────────────────────────────────────────

  const MIN_SCALE = 0.35;
  const MAX_SCALE = 2;

  let viewport = $state<HTMLDivElement | undefined>();
  let scale = $state(1);
  let panX = $state(0);
  let panY = $state(0);
  let hasFitted = false;

  const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

  function fitToView() {
    if (!viewport || layout.width === 0 || layout.height === 0) {
      return;
    }
    const { clientWidth, clientHeight } = viewport;
    // Never scales UP to fill — a two-person tree blown up to fill a desktop viewport looks
    // broken, not fitted.
    scale = clampScale(Math.min(clientWidth / layout.width, clientHeight / layout.height, 1));
    panX = (clientWidth - layout.width * scale) / 2;
    panY = (clientHeight - layout.height * scale) / 2;
  }

  // Fit once, on the first render that actually has a measured viewport and a laid-out graph.
  // Re-fitting on every layout change would yank the canvas out from under someone who has just
  // panned somewhere deliberately.
  $effect(() => {
    if (hasFitted || !viewport || layout.width === 0) {
      return;
    }
    hasFitted = true;
    fitToView();
  });

  const zoomBy = (factor: number) => {
    if (!viewport) {
      return;
    }
    const { clientWidth, clientHeight } = viewport;
    const next = clampScale(scale * factor);
    // Keep the viewport centre fixed, so zooming doesn't drift the tree off-screen.
    panX = clientWidth / 2 - ((clientWidth / 2 - panX) * next) / scale;
    panY = clientHeight / 2 - ((clientHeight / 2 - panY) * next) / scale;
    scale = next;
  };

  function handleWheel(event: WheelEvent) {
    if (!viewport) {
      return;
    }
    event.preventDefault();
    const next = clampScale(scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
    const rect = viewport.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    panX = pointerX - ((pointerX - panX) * next) / scale;
    panY = pointerY - ((pointerY - panY) * next) / scale;
    scale = next;
  }

  let panning = $state(false);
  let panOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

  function handlePointerDown(event: PointerEvent) {
    // Only the empty canvas pans. A pointerdown that lands on a card must be left alone or it
    // would swallow the HTML5 drag that authoring depends on.
    if ((event.target as HTMLElement).closest('[data-family-interactive]')) {
      return;
    }
    panning = true;
    panOrigin = { x: event.clientX, y: event.clientY, panX, panY };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!panning) {
      return;
    }
    panX = panOrigin.panX + (event.clientX - panOrigin.x);
    panY = panOrigin.panY + (event.clientY - panOrigin.y);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!panning) {
      return;
    }
    panning = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  // ── The tray (mockup §1) ───────────────────────────────────────────────────────────────────
  //
  // The drag SOURCE for anyone not already on the canvas. Everything here speaks in `person.id`,
  // never `identityId` — `PersonResponseDto` deliberately withholds the identity id, so a person
  // dragged from here is carried as a person id and resolved server-side (see `FamilyDragKind`).

  let trayQuery = $state('');
  let trayPeople = $state<PersonResponseDto[]>([]);
  let trayLoading = $state(true);
  /** Turns the tray into a root picker: the same list, but a click nominates rather than nothing.
   * Reuses one search rather than growing a second people picker somewhere else. */
  let pickingSelf = $state(false);
  /** The union whose free partner seat is being filled — set by clicking a dashed "+ Add a parent"
   * card, which otherwise had nothing behind it. Steers the same tray list a third way, so the
   * dashed seat is an invitation that can actually be accepted rather than decoration. */
  let fillingUnionId = $state<string | null>(null);
  let rootError = $state(false);

  const trayTitle = $derived(
    pickingSelf
      ? $t('family_link_step_self')
      : fillingUnionId
        ? $t('family_canvas_tray_pick_parent')
        : $t('family_canvas_tray_title'),
  );

  const startFillingSeat = (unionId: string | undefined) => {
    if (!unionId) {
      return;
    }
    pickingSelf = false;
    rootError = false;
    fillingUnionId = fillingUnionId === unionId ? null : unionId;
  };

  async function fillSeat(person: PersonResponseDto) {
    if (!fillingUnionId) {
      return;
    }
    rootError = false;
    try {
      await addParticipant({
        id: fillingUnionId,
        familyParticipantAddDto: { personId: person.id, role: FamilyParticipantRole.Partner },
      });
      fillingUnionId = null;
      onGraphChanged?.();
    } catch {
      rootError = true;
    }
  }

  let trayToken = 0;

  const loadTray = async (rawQuery: string) => {
    const token = ++trayToken;
    trayLoading = true;
    try {
      let result: PersonResponseDto[];
      if (rawQuery) {
        result = await searchPerson({ name: rawQuery, withHidden: false, withSharedSpaces: true });
      } else {
        const all = await getAllPeople({ size: 60, withSharedSpaces: true });
        result = all.people;
      }
      if (token === trayToken) {
        trayPeople = result;
      }
    } catch {
      if (token === trayToken) {
        trayPeople = [];
      }
    } finally {
      if (token === trayToken) {
        trayLoading = false;
      }
    }
  };

  if (canContribute) {
    void loadTray('');
  }

  const onTrayInput = () => void loadTray(trayQuery.trim());

  async function nominateSelf(person: PersonResponseDto) {
    rootError = false;
    try {
      await setMyRoot({ familyMyRootUpdateDto: { personId: person.id } });
      pickingSelf = false;
      onGraphChanged?.();
    } catch {
      rootError = true;
    }
  }

  const viewerName = $derived(viewerRootId ? displayName(viewerRootId) : '');

  // ── Drag and drop (A6, E52, E53) ───────────────────────────────────────────────────────────
  //
  // Drop zones are discrete DOM elements per known card — not a single card region split by
  // pointer coordinates — because that is the only reliably testable shape under happy-dom (and
  // it also makes the affordance's hit area exact rather than approximate). The payload is
  // `identity:<id>` for a card already on the canvas (E53: the same identity moves, it is never
  // re-created) or `person:<id>` for a face dragged in from the tray.

  const DRAG_MIME = 'text/plain';

  type DraggedRef = { kind: FamilyDragKind; id: string };

  const encodeDrag = (ref: DraggedRef) => `${ref.kind}:${ref.id}`;
  const decodeDrag = (raw: string | undefined): DraggedRef | null => {
    if (!raw) {
      return null;
    }
    const separator = raw.indexOf(':');
    // A bare id is an identity: the shape earlier drags used, and what a synthetic DataTransfer
    // in a test is most likely to carry.
    if (separator === -1) {
      return { kind: 'identity', id: raw };
    }
    const kind = raw.slice(0, separator);
    return kind === 'person' || kind === 'identity' ? { kind, id: raw.slice(separator + 1) } : null;
  };

  let dragged = $state<DraggedRef | null>(null);
  /** The card the pointer is currently over during a drag. Only that card offers its gestures.
   * Showing all three zones on every card at once tiled the canvas with boxes that overlapped each
   * other and the neighbouring cards — the mockup puts the gestures around ONE focused card. */
  let hoverTargetId = $state<string | null>(null);

  const showZonesFor = (identityId: string) =>
    canContribute &&
    dragged !== null &&
    hoverTargetId === identityId &&
    !(dragged.kind === 'identity' && dragged.id === identityId);

  /** Kept on `dragover` rather than `dragenter` alone: the zones sit outside the card, so moving
   * onto one would otherwise count as leaving the card and hide the very target being aimed at. */
  const focusTarget = (event: DragEvent, identityId: string) => {
    event.preventDefault();
    hoverTargetId = identityId;
  };

  function handleDragStart(event: DragEvent, ref: DraggedRef) {
    event.dataTransfer?.setData(DRAG_MIME, encodeDrag(ref));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    dragged = ref;
  }

  const handleDragEnd = () => {
    dragged = null;
    hoverTargetId = null;
  };

  function applyJoinLocally(unionId: string, role: FamilyParticipantRole, draggedId: string) {
    const participant: FamilyParticipantDto = { kind: FamilyParticipantKind.Known, identityId: draggedId };
    workingUnions = workingUnions.map((union) => {
      if (union.id !== unionId) {
        return union;
      }
      return role === FamilyParticipantRole.Partner
        ? { ...union, partners: [...union.partners, participant] }
        : { ...union, children: [...union.children, participant] };
    });
  }

  function applyCreateLocally(newUnionId: string, create: FamilyUnionCreateDto) {
    const toParticipants = (ids: string[] | undefined): FamilyParticipantDto[] =>
      (ids ?? []).map((identityId) => ({ kind: FamilyParticipantKind.Known, identityId }));
    workingUnions = [
      ...workingUnions,
      {
        id: newUnionId,
        status: (create.status ?? 'partnered') as FamilyUnionStatus,
        startDate: create.startDate ?? null,
        endDate: create.endDate ?? null,
        partners: toParticipants(create.partnerIds),
        children: toParticipants(create.childIds),
      },
    ];
  }

  async function handleDrop(event: DragEvent, position: FamilyDropPosition, targetId: string) {
    event.preventDefault();
    const ref = decodeDrag(event.dataTransfer?.getData(DRAG_MIME));
    dragged = null;
    hoverTargetId = null;
    if (!ref || (ref.kind === 'identity' && ref.id === targetId)) {
      return;
    }

    const mutation = planFamilyDrop(workingUnions, position, ref.id, targetId, ref.kind);
    try {
      if (mutation.kind === 'join') {
        await addParticipant({
          id: mutation.unionId,
          familyParticipantAddDto:
            ref.kind === 'person'
              ? { personId: ref.id, role: mutation.role }
              : { identityId: ref.id, role: mutation.role },
        });
        if (ref.kind === 'identity') {
          applyJoinLocally(mutation.unionId, mutation.role, ref.id);
        }
      } else {
        const response = await createUnion({ familyUnionCreateDto: mutation.create });
        if (ref.kind === 'identity') {
          applyCreateLocally(response.id, mutation.create);
        }
      }

      // A person drop mints an identity only the server can name, so the local graph cannot be
      // patched honestly — reload it instead of inventing an id.
      if (ref.kind === 'person') {
        onGraphChanged?.();
      }
    } catch {
      // A rejected mutation (arity/cycle/etc. validation on the server) simply leaves the canvas
      // unchanged rather than crashing the page — surfacing this as a toast is left to a future
      // slice.
    }
  }

  // ── Person actions ─────────────────────────────────────────────────────────────────────────
  //
  // A card is not just a label: it is the only place on this surface where you can say who someone
  // IS. Gender is what turns "your parent" into "your mother" (§6) — it belongs to the person, not
  // to a relationship, which is why it hangs off the card rather than off a union pill. Removing
  // takes them out of every union they appear in, since a person half-detached from their family
  // is not a state worth being able to reach by accident.
  //
  // Both reload rather than patching locally: every label on the canvas is derived SERVER-side
  // from the whole graph (D4), so one gender change can reword cards far away from the one edited.

  let openPersonId = $state<string | null>(null);
  let personBusy = $state(false);
  let personError = $state(false);

  /** The person behind the open card, fetched on demand. The graph only carries a name, a gender
   * and a derived label — a birthday, and the profile routing a rename needs, live on the person. */
  let openPerson = $state<PersonResponseDto | null>(null);
  let personLoading = $state(false);
  let draftName = $state('');
  let draftBirthDate = $state('');

  let personToken = 0;

  async function loadPerson(identityId: string) {
    const token = ++personToken;
    personLoading = true;
    openPerson = null;
    try {
      const person = await getIdentityPerson({ id: identityId });
      if (token === personToken) {
        openPerson = person;
        draftName = person.name;
        draftBirthDate = person.birthDate ?? '';
      }
    } catch {
      if (token === personToken) {
        // The card still works for gender and removal, which need only the identity.
        openPerson = null;
      }
    } finally {
      if (token === personToken) {
        personLoading = false;
      }
    }
  }

  const togglePerson = (identityId: string) => {
    personError = false;
    if (openPersonId === identityId) {
      openPersonId = null;
      openPerson = null;
      return;
    }
    openPersonId = identityId;
    void loadPerson(identityId);
  };

  // Renaming and birthdays go through the shared person service, not a family endpoint of their
  // own: it already routes an owner's person to `updatePerson` and a shared-space profile to the
  // space endpoint, and getting that split wrong is a silent 404 on someone else's person.
  async function saveName() {
    if (!openPerson || personBusy || draftName === openPerson.name) {
      return;
    }
    personBusy = true;
    personError = false;
    try {
      openPerson = await updatePersonName(openPerson, draftName);
      onGraphChanged?.();
    } catch {
      personError = true;
    } finally {
      personBusy = false;
    }
  }

  async function saveBirthDate() {
    if (!openPerson || personBusy) {
      return;
    }
    const next = draftBirthDate === '' ? null : draftBirthDate;
    if (next === (openPerson.birthDate ?? null)) {
      return;
    }
    personBusy = true;
    personError = false;
    try {
      await handleUpdatePersonBirthDate(openPerson, next);
      openPerson = { ...openPerson, birthDate: next };
    } catch {
      personError = true;
    } finally {
      personBusy = false;
    }
  }

  const unionsContaining = (identityId: string) =>
    workingUnions.filter((union) =>
      [...union.partners, ...union.children].some((participant) => participant.identityId === identityId),
    );

  async function applyGender(identityId: string, gender: string | null) {
    if (personBusy) {
      return;
    }
    personBusy = true;
    personError = false;
    try {
      await updateGender({ id: identityId, familyGenderUpdateDto: { gender } });
      openPersonId = null;
      openPerson = null;
      onGraphChanged?.();
    } catch {
      personError = true;
    } finally {
      personBusy = false;
    }
  }

  async function removePerson(identityId: string) {
    if (personBusy) {
      return;
    }
    personBusy = true;
    personError = false;
    try {
      for (const union of unionsContaining(identityId)) {
        await removeParticipant({ id: union.id, identityId });
      }
      openPersonId = null;
      openPerson = null;
      onGraphChanged?.();
    } catch {
      personError = true;
    } finally {
      personBusy = false;
    }
  }

  // ── Union editor (A7) ──────────────────────────────────────────────────────────────────────

  let editingUnionId = $state<string | null>(null);

  const toggleEditor = (unionId: string) => {
    editingUnionId = editingUnionId === unionId ? null : unionId;
  };

  // Deletes the RELATIONSHIP, not the people — they stay in the library and in every other union
  // they belong to. Reloads rather than patching locally: dropping a union can strand people the
  // graph reached only through it, which changes labels well beyond the pill that was clicked.
  async function handleUnionDelete(unionId: string) {
    try {
      await deleteUnion({ id: unionId });
      editingUnionId = null;
      workingUnions = workingUnions.filter((union) => union.id !== unionId);
      onGraphChanged?.();
    } catch {
      // Leaves the editor open rather than closing as though it had worked.
    }
  }

  async function handleUnionSave(unionId: string, payload: FamilyUnionEditorSave) {
    try {
      await updateUnion({
        id: unionId,
        familyUnionUpdateDto: { status: payload.status, startDate: payload.startDate, endDate: payload.endDate },
      });
      workingUnions = workingUnions.map((union) =>
        union.id === unionId
          ? { ...union, status: payload.status, startDate: payload.startDate, endDate: payload.endDate }
          : union,
      );
      editingUnionId = null;
    } catch {
      // Left open on failure so the viewer's edits aren't silently discarded; a future slice can
      // surface the server's validation message (e.g. the same end/start ordering check) here.
    }
  }
</script>

<div class="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-light dark:border-gray-800">
  <!-- Toolbar (mockup §1) -->
  <div class="flex flex-wrap items-center gap-2 px-4 py-3">
    {#if canContribute}
      <button
        type="button"
        data-testid="family-root-button"
        class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
        class:border-primary={pickingSelf}
        class:text-primary={pickingSelf}
        onclick={() => (pickingSelf = !pickingSelf)}
      >
        {viewerName ? $t('family_canvas_you_are', { values: { name: viewerName } }) : $t('family_canvas_set_root')}
      </button>
    {/if}

    <button
      type="button"
      data-testid="family-fit-to-view"
      class="rounded-full border border-gray-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
      onclick={fitToView}
    >
      {$t('family_canvas_fit_to_view')}
    </button>

    <div class="flex items-center gap-1">
      <button
        type="button"
        aria-label={$t('family_canvas_zoom_out')}
        class="size-7 rounded-full border border-gray-300 text-sm leading-none transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
        onclick={() => zoomBy(1 / 1.2)}
      >
        −
      </button>
      <button
        type="button"
        aria-label={$t('family_canvas_zoom_in')}
        class="size-7 rounded-full border border-gray-300 text-sm leading-none transition-colors hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
        onclick={() => zoomBy(1.2)}
      >
        +
      </button>
    </div>
  </div>

  <div
    class="grid min-h-0 grid-cols-1 border-t border-gray-200 md:grid-cols-[13rem_minmax(0,1fr)] dark:border-gray-800"
  >
    {#if canContribute}
      <!-- Tray: the drag source for anyone not already on the canvas (mockup §1) -->
      <aside
        data-testid="family-tray"
        class="flex min-h-0 min-w-0 flex-col gap-3 border-b border-gray-200 bg-gray-50 p-3 md:border-r md:border-b-0 dark:border-gray-800 dark:bg-gray-900/40"
      >
        <h4 class="text-xs font-semibold tracking-wide text-gray-500 uppercase">{trayTitle}</h4>

        <input
          class="rounded-lg border border-gray-300 bg-light px-2.5 py-1.5 text-xs dark:border-gray-700"
          placeholder={$t('family_link_search_placeholder')}
          aria-label={$t('family_link_search_placeholder')}
          bind:value={trayQuery}
          oninput={onTrayInput}
        />

        <div class="grid max-h-72 min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto md:max-h-none">
          {#each trayPeople as person (person.id)}
            <!-- One element for both modes: dragging it places the person on the canvas, and
                 while the tray is picking a root a click nominates them instead. A button rather
                 than a div so the drag handle is focusable and announced. -->
            <button
              type="button"
              data-testid="family-tray-person"
              data-person-id={person.id}
              class="min-w-0 text-center"
              class:cursor-grab={!pickingSelf && !fillingUnionId}
              draggable={!pickingSelf && !fillingUnionId}
              onclick={() => {
                if (pickingSelf) {
                  void nominateSelf(person);
                } else if (fillingUnionId) {
                  void fillSeat(person);
                }
              }}
              ondragstart={(event) => handleDragStart(event, { kind: 'person', id: person.id })}
              ondragend={handleDragEnd}
            >
              <img
                class="mx-auto size-11 rounded-full object-cover"
                src={getPeopleThumbnailUrl(person)}
                alt=""
                draggable="false"
              />
              <span class="mt-1 block truncate text-[10px] text-gray-500">
                {person.name || $t('family_person_anonymous_name')}
              </span>
            </button>
          {/each}
        </div>

        {#if !trayLoading && trayPeople.length === 0}
          <p class="text-xs text-gray-500">{$t('family_link_no_matches')}</p>
        {/if}

        {#if rootError}
          <p class="text-xs text-red-500" data-testid="family-root-error">{$t('family_canvas_root_error')}</p>
        {/if}

        <p
          class="mt-auto border-t border-dashed border-gray-300 pt-2 text-[11px] leading-snug text-gray-500 dark:border-gray-700"
        >
          {$t('family_canvas_tray_note')}
        </p>
      </aside>
    {/if}

    <!-- Canvas. Its height fills what the page layout leaves below the header and cluster chips,
         rather than the fixed 32rem that left most of the screen empty. -->
    <div
      bind:this={viewport}
      data-testid="family-canvas"
      role="presentation"
      class="relative h-[calc(100dvh-var(--navbar-height)-12rem)] min-h-96 touch-none overflow-hidden select-none"
      class:cursor-grabbing={panning}
      onwheel={handleWheel}
      onpointerdown={handlePointerDown}
      onpointermove={handlePointerMove}
      onpointerup={handlePointerUp}
      onpointercancel={handlePointerUp}
    >
      <!-- Dot grid, drawn as a pattern so it inherits the theme through `currentColor` rather
           than hard-coding two background images. -->
      <svg class="pointer-events-none absolute inset-0 size-full text-gray-300 dark:text-gray-700" aria-hidden="true">
        <defs>
          <pattern id="family-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#family-dots)" />
      </svg>

      <div
        class="absolute top-0 left-0 origin-top-left"
        style="width:{layout.width}px;height:{layout.height}px;transform:translate({panX}px,{panY}px) scale({scale})"
      >
        <!-- Connectors. Behind the cards, so a line may start under a card edge without showing. -->
        <svg
          class="pointer-events-none absolute inset-0"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          <g fill="none" stroke-width="2" stroke-linecap="round">
            {#each layout.unions as union (union.unionId)}
              {#if union.childPath}
                <path class="stroke-gray-300 dark:stroke-gray-600" d={union.childPath} />
              {/if}
              {#if union.partnerPath}
                <path
                  class={isEnded(union.status)
                    ? 'stroke-amber-600 dark:stroke-amber-400'
                    : 'stroke-gray-300 dark:stroke-gray-600'}
                  stroke-dasharray={isEnded(union.status) ? '5 4' : undefined}
                  d={union.partnerPath}
                />
              {/if}
            {/each}
          </g>
        </svg>

        <!-- Generation gutter labels -->
        {#each layout.generations as generation (generation.generation)}
          <div
            class="pointer-events-none absolute text-[10px] font-semibold tracking-widest text-gray-400 uppercase dark:text-gray-500"
            style="left:6px;top:{generation.y}px"
          >
            {$t('family_canvas_generation_label', { values: { offset: generation.generation } })}
          </div>
        {/each}

        <!-- Cards -->
        {#each layout.seats as seat (seat.key)}
          {#if seat.kind === 'known'}
            {@const identityId = seat.identityId!}
            {@const label = relationLabel(identityId)}
            {@const isRoot = identityId === viewerRootId}

            {#if isRoot}
              <div
                class="pointer-events-none absolute rounded-full bg-primary/15 px-2 py-px text-[10px] font-semibold tracking-wide text-primary uppercase"
                style="left:{seat.x}px;top:{seat.y - 15}px"
              >
                {$t('family_canvas_you_are_here')}
              </div>
            {/if}

            <div
              data-testid="family-node"
              data-family-interactive
              data-identity-id={identityId}
              role="button"
              tabindex={canContribute ? 0 : -1}
              class="absolute flex items-center gap-3 rounded-2xl border bg-light px-3 shadow-sm"
              class:border-primary={isRoot}
              class:ring-3={isRoot}
              class:ring-primary-100={isRoot}
              class:border-gray-200={!isRoot}
              class:dark:border-gray-700={!isRoot}
              class:cursor-grab={canContribute}
              style="left:{seat.x}px;top:{seat.y}px;width:{FAMILY_CARD_WIDTH}px;height:{FAMILY_CARD_HEIGHT}px"
              draggable={canContribute}
              onclick={() => canContribute && togglePerson(identityId)}
              onkeydown={(event) => {
                if (!canContribute || (event.key !== 'Enter' && event.key !== ' ')) {
                  return;
                }
                event.preventDefault();
                togglePerson(identityId);
              }}
              ondragstart={(event) => handleDragStart(event, { kind: 'identity', id: identityId })}
              ondragend={handleDragEnd}
              ondragover={(event) => focusTarget(event, identityId)}
            >
              <div
                class="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-gray-200 text-[13px] font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300"
              >
                {initials(identities[identityId]?.name)}
                {#if !brokenThumbnails.has(identityId)}
                  <img
                    class="absolute inset-0 size-full object-cover"
                    src={getFamilyIdentityThumbnailUrl(identityId)}
                    alt=""
                    draggable="false"
                    onerror={() => brokenThumbnails.add(identityId)}
                  />
                {/if}
              </div>

              <div class="min-w-0">
                <div class="truncate text-[13.5px] leading-tight font-medium" title={displayName(identityId)}>
                  {displayName(identityId)}
                </div>
                {#if label}
                  <!-- Two lines before it clips, and the full text on hover: derived labels run to
                       "your niece's partner", which no single line of a card will ever hold. -->
                  <div
                    class="line-clamp-2 text-[11.5px] leading-snug text-gray-500"
                    data-testid="family-node-relation"
                    title={label}
                  >
                    {label}
                  </div>
                {/if}
              </div>
            </div>

            {#if canContribute && openPersonId === identityId}
              <div
                data-testid="family-person-menu"
                data-family-interactive
                class="absolute z-40 flex w-64 flex-col gap-3 rounded-xl border border-gray-300 bg-light p-3 shadow-lg dark:border-gray-700"
                style="left:{seat.x}px;top:{seat.y + FAMILY_CARD_HEIGHT + 8}px"
              >
                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    {$t('family_canvas_person_name_label')}
                  </span>
                  {#if personLoading}
                    <span class="text-[11px] text-gray-500">{$t('family_canvas_person_loading')}</span>
                  {:else if openPerson}
                    <input
                      data-testid="family-person-name"
                      class="rounded-lg border border-gray-300 bg-light px-2 py-1 text-[12px] dark:border-gray-700"
                      aria-label={$t('family_canvas_person_name_label')}
                      bind:value={draftName}
                      disabled={personBusy}
                      onblur={() => void saveName()}
                    />
                  {:else}
                    <span class="text-[12px] font-medium">{displayName(identityId)}</span>
                  {/if}
                </div>

                {#if openPerson}
                  <div class="flex flex-col gap-1">
                    <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                      {$t('family_canvas_person_birthdate_label')}
                    </span>
                    <input
                      type="date"
                      data-testid="family-person-birthdate"
                      class="rounded-lg border border-gray-300 bg-light px-2 py-1 text-[12px] dark:border-gray-700"
                      aria-label={$t('family_canvas_person_birthdate_label')}
                      bind:value={draftBirthDate}
                      disabled={personBusy}
                      onchange={() => void saveBirthDate()}
                    />
                  </div>
                {/if}

                {#if relationLabel(identityId)}
                  <div class="text-[11px] text-gray-500">{relationLabel(identityId)}</div>
                {/if}

                <div class="flex flex-col gap-1">
                  <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">
                    {$t('family_canvas_gender_label')}
                  </span>
                  <div class="flex flex-wrap gap-1">
                    {#each [{ value: null, key: 'family_canvas_gender_unset' }, { value: 'male', key: 'family_canvas_gender_male' }, { value: 'female', key: 'family_canvas_gender_female' }] as option (option.key)}
                      {@const selected = (identities[identityId]?.gender ?? null) === option.value}
                      <button
                        type="button"
                        data-testid="family-person-gender-option"
                        data-selected={selected}
                        class="rounded-full border px-2.5 py-0.5 text-[11px]"
                        class:border-primary={selected}
                        class:text-primary={selected}
                        class:border-gray-300={!selected}
                        class:dark:border-gray-600={!selected}
                        disabled={personBusy}
                        onclick={() => void applyGender(identityId, option.value)}
                      >
                        {$t(option.key as Translations)}
                      </button>
                    {/each}
                  </div>
                  <p class="text-[10.5px] leading-snug text-gray-500">{$t('family_canvas_gender_hint')}</p>
                </div>

                <button
                  type="button"
                  data-testid="family-person-remove"
                  class="rounded-lg border border-red-300 px-2.5 py-1 text-[11px] font-medium text-red-500 dark:border-red-500/50"
                  disabled={personBusy}
                  onclick={() => void removePerson(identityId)}
                >
                  {$t('family_canvas_remove_person')}
                </button>

                {#if personError}
                  <p class="text-[11px] text-red-500" data-testid="family-person-error">
                    {$t('family_canvas_person_error')}
                  </p>
                {/if}
              </div>
            {/if}

            {#if showZonesFor(identityId)}
              <div
                data-testid="family-drop-zone"
                data-family-interactive
                data-position="above"
                data-target-id={identityId}
                role="button"
                tabindex="-1"
                class="absolute z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-light/95 p-1 text-center text-[10px] leading-tight font-semibold text-primary shadow-md"
                style="left:{seat.x}px;top:{seat.y - 62}px;width:{FAMILY_CARD_WIDTH}px;height:56px"
                ondragover={(event) => focusTarget(event, identityId)}
                ondrop={(event) => handleDrop(event, 'above', identityId)}
              >
                {$t('family_edit_drop_above')}
              </div>
              <div
                data-testid="family-drop-zone"
                data-family-interactive
                data-position="below"
                data-target-id={identityId}
                role="button"
                tabindex="-1"
                class="absolute z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-light/95 p-1 text-center text-[10px] leading-tight font-semibold text-primary shadow-md"
                style="left:{seat.x}px;top:{seat.y + FAMILY_CARD_HEIGHT + 6}px;width:{FAMILY_CARD_WIDTH}px;height:56px"
                ondragover={(event) => focusTarget(event, identityId)}
                ondrop={(event) => handleDrop(event, 'below', identityId)}
              >
                {$t('family_edit_drop_below')}
              </div>
              <div
                data-testid="family-drop-zone"
                data-family-interactive
                data-position="beside"
                data-target-id={identityId}
                role="button"
                tabindex="-1"
                class="absolute z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-light/95 p-1 text-center text-[10px] leading-tight font-semibold text-primary shadow-md"
                style="left:{seat.x + FAMILY_CARD_WIDTH + 6}px;top:{seat.y + 10}px;width:62px;height:56px"
                ondragover={(event) => focusTarget(event, identityId)}
                ondrop={(event) => handleDrop(event, 'beside', identityId)}
              >
                {$t('family_edit_drop_beside')}
              </div>
            {/if}
          {:else if seat.kind === 'anonymous'}
            <div
              data-testid="family-anonymous-seat"
              class="absolute flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-100 px-3 dark:border-gray-700 dark:bg-gray-800"
              style="left:{seat.x}px;top:{seat.y}px;width:{FAMILY_CARD_WIDTH}px;height:{FAMILY_CARD_HEIGHT}px"
            >
              <div
                class="grid size-11 shrink-0 place-items-center rounded-full border border-dashed border-gray-400 bg-gray-200 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              >
                ?
              </div>
              <div class="min-w-0">
                <div class="truncate text-[13.5px] text-gray-500 italic">{$t('family_canvas_anonymous_name')}</div>
              </div>
            </div>
          {:else}
            <button
              type="button"
              data-testid="family-empty-seat"
              data-family-interactive
              data-union-id={seat.unionId}
              data-active={fillingUnionId === seat.unionId}
              class="absolute flex items-center justify-center rounded-2xl border-2 border-dashed text-center text-[12.5px] font-medium transition-colors"
              class:border-primary={fillingUnionId === seat.unionId}
              class:text-primary={fillingUnionId === seat.unionId}
              class:border-gray-300={fillingUnionId !== seat.unionId}
              class:text-gray-500={fillingUnionId !== seat.unionId}
              class:dark:border-gray-600={fillingUnionId !== seat.unionId}
              style="left:{seat.x}px;top:{seat.y}px;width:{FAMILY_CARD_WIDTH}px;height:{FAMILY_CARD_HEIGHT}px"
              onclick={() => startFillingSeat(seat.unionId)}
            >
              <span aria-hidden="true">+</span>&nbsp;{$t('family_canvas_add_parent')}
            </button>
          {/if}
        {/each}

        <!-- Union pills, sitting on the connector between the partners -->
        {#each layout.unions as union (union.unionId)}
          {@const ended = isEnded(union.status)}
          <div
            class="absolute -translate-x-1/2"
            class:z-30={editingUnionId === union.unionId}
            style="left:{union.x}px;top:{union.y}px"
          >
            {#if canContribute}
              <button
                type="button"
                data-testid="family-union-bar"
                data-family-interactive
                data-status={union.status}
                data-ended={ended}
                aria-label={$t('family_edit_union_edit_button_label')}
                class="rounded-full border bg-light px-2.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap"
                class:border-gray-300={!ended}
                class:text-gray-500={!ended}
                class:dark:border-gray-600={!ended}
                class:border-amber-600={ended}
                class:text-amber-700={ended}
                class:dark:border-amber-400={ended}
                class:dark:text-amber-300={ended}
                onclick={() => toggleEditor(union.unionId)}
              >
                {unionText(union)}
              </button>
            {:else}
              <span
                data-testid="family-union-bar"
                data-status={union.status}
                data-ended={ended}
                class="rounded-full border bg-light px-2.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap"
                class:border-gray-300={!ended}
                class:text-gray-500={!ended}
                class:dark:border-gray-600={!ended}
                class:border-amber-600={ended}
                class:text-amber-700={ended}
                class:dark:border-amber-400={ended}
                class:dark:text-amber-300={ended}
              >
                {unionText(union)}
              </span>
            {/if}

            {#if canContribute && editingUnionId === union.unionId}
              <div data-family-interactive class="absolute top-8 left-1/2 z-20 -translate-x-1/2">
                <FamilyUnionEditor
                  status={union.status as FamilyUnionStatus}
                  startDate={union.startDate}
                  endDate={union.endDate}
                  onSave={(payload) => handleUnionSave(union.unionId, payload)}
                  onCancel={() => (editingUnionId = null)}
                  onDelete={() => void handleUnionDelete(union.unionId)}
                />
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
