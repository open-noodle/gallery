<script lang="ts">
  import {
    addParticipant,
    createUnion,
    FamilyParticipantRole,
    Kind,
    updateUnion,
    type FamilyIdentityDto,
    type FamilyParticipantDto,
    type FamilyUnionCreateDto,
    type FamilyUnionDto,
    type FamilyUnionStatus,
  } from '@immich/sdk';
  import FamilyUnionEditor, { type FamilyUnionEditorSave } from '$lib/components/family/FamilyUnionEditor.svelte';
  import { planFamilyDrop, type FamilyDropPosition } from '$lib/utils/family-editing';
  import { buildFamilyLayout, type FamilyLayoutUnion } from '$lib/utils/family-layout';
  import { t, type Translations } from 'svelte-i18n';

  interface Props {
    unions: FamilyUnionDto[];
    identities: Record<string, FamilyIdentityDto>;
    /** The generation anchor — the viewer's own root when it is a member of this cluster,
     * otherwise the cluster's `rootCandidateId` (D6: layout is computed per viewer, never
     * stored, so there is always some anchor to lay the graph out around). */
    rootId: string;
    /** A6: gates the dashed "+ Add a parent" affordance, the drag/drop zones and the union editor.
     * A view-only viewer sees none of it at all — not a disabled version of it. */
    canContribute: boolean;
  }

  let { unions, identities, rootId, canContribute }: Props = $props();

  // Slice 11 (D6/E52/E53): the canvas mutates its OWN local copy of the graph so a drop can
  // re-render immediately, without waiting on a full page reload of `+page.ts`'s data. `unions`
  // itself is never mutated — only ever read again if the prop identity changes (a fresh page
  // load), which is why this is a plain `$state` snapshot rather than something kept in sync via
  // an `$effect`.
  let workingUnions = $state<FamilyUnionDto[]>(unions);

  const layout = $derived(buildFamilyLayout(workingUnions, rootId, canContribute));

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

  // `layout.unions` is already sorted by `partnerGeneration` (see `buildFamilyLayout`), so a
  // plain filter per row is enough — no need for a Map to group them by.
  const unionsForGeneration = (generation: number): FamilyLayoutUnion[] =>
    layout.unions.filter((union) => union.partnerGeneration === generation);

  const initials = (name: string | undefined) =>
    (name ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

  const displayName = (identityId: string) => identities[identityId]?.label ?? identities[identityId]?.name ?? '';

  // ── Drag and drop (Task 1: A6, E52, E53) ──────────────────────────────────────────────────
  //
  // Drop zones are discrete DOM elements per known card — not a single card region split by
  // pointer coordinates — because that is the only reliably testable shape under happy-dom
  // (and it also makes the affordance's hit area exact rather than approximate). A card is only
  // ever dragged from ITS OWN rendered seat (E53): the identity payload is nothing more than the
  // dragged identityId as plain text, since the identity is always already present in
  // `identities` — there is no "new person" branch here for this slice (see the slice 11 report
  // for why: no tray/search surface exists yet to originate a drag for someone not already on
  // the canvas).
  const DRAG_MIME = 'text/plain';

  let draggingIdentityId = $state<string | null>(null);

  const showZonesFor = (identityId: string) =>
    canContribute && draggingIdentityId !== null && draggingIdentityId !== identityId;

  function handleDragStart(event: DragEvent, identityId: string) {
    event.dataTransfer?.setData(DRAG_MIME, identityId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    draggingIdentityId = identityId;
  }

  function handleDragEnd() {
    draggingIdentityId = null;
  }

  function handleDragOver(event: DragEvent) {
    // Required so the browser treats this element as a valid drop target at all.
    event.preventDefault();
  }

  function applyJoinLocally(unionId: string, role: FamilyParticipantRole, draggedId: string) {
    const participant: FamilyParticipantDto = { kind: Kind.Known, identityId: draggedId };
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
      (ids ?? []).map((identityId) => ({ kind: Kind.Known, identityId }));
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
    const draggedId = event.dataTransfer?.getData(DRAG_MIME);
    draggingIdentityId = null;
    if (!draggedId || draggedId === targetId) {
      return;
    }

    const mutation = planFamilyDrop(workingUnions, position, draggedId, targetId);
    try {
      if (mutation.kind === 'join') {
        await addParticipant({
          id: mutation.unionId,
          familyParticipantAddDto: { identityId: draggedId, role: mutation.role },
        });
        applyJoinLocally(mutation.unionId, mutation.role, draggedId);
      } else {
        const response = await createUnion({ familyUnionCreateDto: mutation.create });
        applyCreateLocally(response.id, mutation.create);
      }
    } catch {
      // A rejected mutation (arity/cycle/etc. validation on the server) simply leaves the canvas
      // unchanged rather than crashing the page — surfacing this as a toast is left to a future
      // slice.
    }
  }

  // ── Union editor (Task 2: A7) ──────────────────────────────────────────────────────────────

  let editingUnionId = $state<string | null>(null);

  const toggleEditor = (unionId: string) => {
    editingUnionId = editingUnionId === unionId ? null : unionId;
  };

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

<div data-testid="family-canvas" class="flex flex-col gap-6 overflow-auto p-4">
  {#each layout.rows as row (row.generation)}
    <div class="flex flex-col gap-2">
      <div class="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {$t('family_canvas_generation_label', { values: { offset: row.generation } })}
      </div>

      <div class="flex flex-wrap items-stretch gap-3">
        {#each row.seats as seat (seat.key)}
          {#if seat.kind === 'known'}
            {@const identityId = seat.identityId!}
            <div class="flex flex-col items-stretch gap-1">
              {#if showZonesFor(identityId)}
                <div
                  data-testid="family-drop-zone"
                  data-position="above"
                  data-target-id={identityId}
                  role="button"
                  tabindex="-1"
                  class="flex h-6 w-40 items-center justify-center rounded-sm border-2 border-dashed border-primary text-[10px] font-medium text-primary"
                  ondragover={handleDragOver}
                  ondrop={(event) => handleDrop(event, 'above', identityId)}
                >
                  {$t('family_edit_drop_above')}
                </div>
              {/if}

              <div class="flex items-stretch gap-1">
                <div
                  data-testid="family-node"
                  role="button"
                  tabindex={canContribute ? 0 : -1}
                  class="bg-surface flex w-40 items-center gap-2 rounded-lg border border-gray-300 p-2 shadow-sm dark:border-gray-700"
                  class:border-primary={identityId === rootId}
                  draggable={canContribute}
                  ondragstart={(event) => handleDragStart(event, identityId)}
                  ondragend={handleDragEnd}
                >
                  <div
                    class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-300 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-100"
                  >
                    {initials(identities[identityId]?.name)}
                  </div>
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{displayName(identityId)}</div>
                  </div>
                </div>

                {#if showZonesFor(identityId)}
                  <div
                    data-testid="family-drop-zone"
                    data-position="beside"
                    data-target-id={identityId}
                    role="button"
                    tabindex="-1"
                    class="flex w-10 items-center justify-center rounded-sm border-2 border-dashed border-primary text-center text-[10px] font-medium text-primary"
                    ondragover={handleDragOver}
                    ondrop={(event) => handleDrop(event, 'beside', identityId)}
                  >
                    {$t('family_edit_drop_beside')}
                  </div>
                {/if}
              </div>

              {#if showZonesFor(identityId)}
                <div
                  data-testid="family-drop-zone"
                  data-position="below"
                  data-target-id={identityId}
                  role="button"
                  tabindex="-1"
                  class="flex h-6 w-40 items-center justify-center rounded-sm border-2 border-dashed border-primary text-[10px] font-medium text-primary"
                  ondragover={handleDragOver}
                  ondrop={(event) => handleDrop(event, 'below', identityId)}
                >
                  {$t('family_edit_drop_below')}
                </div>
              {/if}
            </div>
          {:else if seat.kind === 'anonymous'}
            <div
              data-testid="family-anonymous-seat"
              class="flex w-40 items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 p-2 dark:border-gray-700 dark:bg-gray-800"
            >
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed bg-gray-200 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              >
                ?
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-gray-500 italic">
                  {$t('family_canvas_anonymous_name')}
                </div>
              </div>
            </div>
          {:else}
            <div
              data-testid="family-empty-seat"
              class="flex w-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-2 text-center text-xs font-medium text-gray-500 dark:border-gray-600"
            >
              <span aria-hidden="true">+</span>&nbsp;{$t('family_canvas_add_parent')}
            </div>
          {/if}
        {/each}
      </div>

      {#if unionsForGeneration(row.generation).length > 0}
        <div class="flex flex-wrap gap-2">
          {#each unionsForGeneration(row.generation) as familyUnion (familyUnion.unionId)}
            {@const startYear = toYear(familyUnion.startDate)}
            {@const endYear = toYear(familyUnion.endDate)}
            <div class="flex flex-col gap-2">
              {#if canContribute}
                <button
                  type="button"
                  data-testid="family-union-bar"
                  data-status={familyUnion.status}
                  data-ended={isEnded(familyUnion.status)}
                  aria-label={$t('family_edit_union_edit_button_label')}
                  class="rounded-full border px-3 py-0.5 text-xs font-medium"
                  class:border-gray-300={!isEnded(familyUnion.status)}
                  class:text-gray-500={!isEnded(familyUnion.status)}
                  class:border-warning={isEnded(familyUnion.status)}
                  class:text-warning={isEnded(familyUnion.status)}
                  class:border-dashed={isEnded(familyUnion.status)}
                  onclick={() => toggleEditor(familyUnion.unionId)}
                >
                  {#if startYear && endYear}
                    {startYear} – {endYear} · {$t(statusKey(familyUnion.status))}
                  {:else if startYear}
                    {$t(statusKey(familyUnion.status))} {startYear}
                  {:else}
                    {$t(statusKey(familyUnion.status))}
                  {/if}
                </button>
              {:else}
                <span
                  data-testid="family-union-bar"
                  data-status={familyUnion.status}
                  data-ended={isEnded(familyUnion.status)}
                  class="rounded-full border px-3 py-0.5 text-xs font-medium"
                  class:border-gray-300={!isEnded(familyUnion.status)}
                  class:text-gray-500={!isEnded(familyUnion.status)}
                  class:border-warning={isEnded(familyUnion.status)}
                  class:text-warning={isEnded(familyUnion.status)}
                  class:border-dashed={isEnded(familyUnion.status)}
                >
                  {#if startYear && endYear}
                    {startYear} – {endYear} · {$t(statusKey(familyUnion.status))}
                  {:else if startYear}
                    {$t(statusKey(familyUnion.status))} {startYear}
                  {:else}
                    {$t(statusKey(familyUnion.status))}
                  {/if}
                </span>
              {/if}

              {#if canContribute && editingUnionId === familyUnion.unionId}
                <FamilyUnionEditor
                  status={familyUnion.status as FamilyUnionStatus}
                  startDate={familyUnion.startDate}
                  endDate={familyUnion.endDate}
                  onSave={(payload) => handleUnionSave(familyUnion.unionId, payload)}
                  onCancel={() => (editingUnionId = null)}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
