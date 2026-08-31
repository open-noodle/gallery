<script lang="ts">
  import type { FamilyIdentityDto, FamilyUnionDto } from '@immich/sdk';
  import { buildFamilyLayout, type FamilyLayoutUnion } from '$lib/utils/family-layout';
  import { t, type Translations } from 'svelte-i18n';

  interface Props {
    unions: FamilyUnionDto[];
    identities: Record<string, FamilyIdentityDto>;
    /** The generation anchor — the viewer's own root when it is a member of this cluster,
     * otherwise the cluster's `rootCandidateId` (D6: layout is computed per viewer, never
     * stored, so there is always some anchor to lay the graph out around). */
    rootId: string;
    /** A6: gates the dashed "+ Add a parent" affordance for a missing partner seat. A view-only
     * viewer sees no affordance at all — not a disabled version of it. */
    canContribute: boolean;
  }

  let { unions, identities, rootId, canContribute }: Props = $props();

  const layout = $derived(buildFamilyLayout(unions, rootId, canContribute));

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
            <div
              data-testid="family-node"
              class="bg-surface flex w-40 items-center gap-2 rounded-lg border border-gray-300 p-2 shadow-sm dark:border-gray-700"
              class:border-primary={seat.identityId === rootId}
            >
              <div
                class="flex size-9 shrink-0 items-center justify-center rounded-full bg-gray-300 text-xs font-semibold text-gray-700 dark:bg-gray-600 dark:text-gray-100"
              >
                {initials(identities[seat.identityId!]?.name)}
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">{displayName(seat.identityId!)}</div>
              </div>
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
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
