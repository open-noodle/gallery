<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { dissolvePerson, previewDissolvePerson } from '@immich/sdk';
  import type { DissolveRequestDto, DissolveResponseDto } from '@immich/sdk';
  import { Button, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import { t, type Translations } from 'svelte-i18n';

  // `DissolveRequestDto['scope']` is the generated `DissolveScope` ENUM, whose members are exactly these strings at
  // runtime; `${...}` widens it to that literal union. Deliberate: an enum is a runtime VALUE, so importing it
  // would break any spec that stubs `@immich/sdk` with a factory mock of just the two endpoints. buildRequest
  // is the single place the two representations meet. The outcome is already a literal union in the DTO.
  type DissolveScope = `${DissolveRequestDto['scope']}`;
  type DissolveOutcome = DissolveRequestDto['outcome'];

  type Props = {
    personId: string;
    personName: string;
    onClose: (dissolved?: boolean) => void;
  };

  const { personId, personName, onClose }: Props = $props();

  const SCOPES: { value: DissolveScope; label: Translations }[] = [
    { value: 'all', label: 'admin.face_cleanup_dissolve_scope_all' },
    { value: 'exif', label: 'admin.face_cleanup_dissolve_scope_exif' },
    { value: 'machine-learning', label: 'admin.face_cleanup_dissolve_scope_ml' },
    { value: 'without-embedding', label: 'admin.face_cleanup_dissolve_scope_no_embedding' },
  ];

  const OUTCOMES: { value: DissolveOutcome; label: Translations }[] = [
    { value: 'delete-faces', label: 'admin.face_cleanup_dissolve_outcome_delete' },
    { value: 'delete-faces-and-person', label: 'admin.face_cleanup_dissolve_outcome_delete_person' },
    { value: 'unassign', label: 'admin.face_cleanup_dissolve_outcome_unassign' },
  ];

  // Contract with buildWarnings() in face-dissolve.service.ts — those five codes and no others. Typed
  // `Translations`, not `string`: `$t` only accepts keys that exist in en.json, so a typo here is a build
  // error rather than a raw key rendered at an admin. An unknown code renders nothing at all.
  const WARNING_KEY_BY_CODE: Record<string, Translations | undefined> = {
    'strands-faces': 'admin.face_cleanup_dissolve_warn_strands_faces',
    'recluster-similar': 'admin.face_cleanup_dissolve_warn_recluster_similar',
    'not-redetectable': 'admin.face_cleanup_dissolve_warn_not_redetectable',
    'shared-assets': 'admin.face_cleanup_dissolve_warn_shared_assets',
    'metadata-import-on': 'admin.face_cleanup_dissolve_warn_metadata_import_on',
  };

  const PREVIEW_DEBOUNCE_MS = 250;

  // `exif` by default, not `all`: the imported-metadata faces are the contamination this dialog exists for,
  // and the broadest destructive selection is the wrong opening state for an operation with no undo. Widening
  // to `all` is one click; a delete the admin did not intend is not undoable at all.
  let scope = $state<DissolveScope>('exif');
  let outcome = $state<DissolveOutcome>('delete-faces');
  // The server REFUSES a delete outcome carrying redetect:false with a 400 rather than silently overriding it
  // (validate(), face-dissolve.service.ts), so the checkbox is forced on and locked for both deletes. This
  // holds the admin's own choice, which only ever reaches the wire for `unassign`.
  let redetectWhenUnassigning = $state(true);
  let preview = $state<DissolveResponseDto | null>(null);
  // True from mount until the first preview lands, and again while a control change is unaccounted for. The
  // counts are the only thing between an admin and an irreversible delete, so applying while they describe a
  // selection other than the current one is exactly what this gate exists to prevent.
  let previewing = $state(true);
  let confirmation = $state('');
  let applying = $state(false);

  const isDelete = $derived(outcome !== 'unassign');
  const redetect = $derived(isDelete || redetectWhenUnassigning);
  const outcomeLabel = $derived(OUTCOMES.find(({ value }) => value === outcome)!.label);
  // The length check is not redundant: a blank `personName` would otherwise make an empty box "match" and hand
  // an irreversible delete a gate that is already open.
  const expectedName = $derived(personName.trim().toLowerCase());
  const nameConfirmed = $derived(expectedName.length > 0 && confirmation.trim().toLowerCase() === expectedName);
  const canApply = $derived(nameConfirmed && preview !== null && !previewing && !applying);

  const warnings = $derived(
    (preview?.warnings ?? [])
      .map(({ code, count }) => ({ code, count, key: WARNING_KEY_BY_CODE[code] }))
      .filter((warning): warning is { code: string; count: number; key: Translations } => !!warning.key),
  );

  // Face-level counts first, then photo-level ones. `notRedetectable` earns its cell even though its warning
  // repeats the number: it is the one part of the blast radius that no re-detection can put back, and the
  // warning is suppressed entirely when redetect is off.
  const countCells = $derived([
    { key: 'faces', label: 'admin.face_cleanup_col_faces' as Translations, value: preview?.counts.faces },
    { key: 'exif', label: 'admin.face_cleanup_dissolve_scope_exif' as Translations, value: preview?.counts.exif },
    {
      key: 'ml',
      label: 'admin.face_cleanup_dissolve_scope_ml' as Translations,
      value: preview?.counts.mlWithEmbedding,
    },
    {
      key: 'no-embedding',
      label: 'admin.face_cleanup_dissolve_scope_no_embedding' as Translations,
      value: preview?.counts.mlWithoutEmbedding,
    },
    {
      key: 'detached',
      label: 'admin.face_cleanup_review_tile_detach_ribbon' as Translations,
      value: preview?.counts.softDeleted,
    },
    { key: 'assets', label: 'photos' as Translations, value: preview?.counts.assets },
    {
      key: 'not-redetectable',
      label: 'admin.face_cleanup_dissolve_count_not_redetectable' as Translations,
      value: preview?.counts.notRedetectable,
    },
  ]);

  const buildRequest = (expectedFaceCount: number): DissolveRequestDto => ({
    scope: scope as DissolveRequestDto['scope'],
    outcome,
    redetect,
    expectedFaceCount,
  });

  let debounceHandle: ReturnType<typeof setTimeout> | undefined;
  // Monotonic: a slow preview for a selection the admin has already moved off must not land on top of a newer
  // one and leave the counts describing something other than what the controls say.
  let previewToken = 0;

  const runPreview = async () => {
    const token = ++previewToken;
    // Marked stale here too, not only in schedulePreview: a preview that FAILS must leave the gate closed, and
    // apply() re-previews after a 409 — where the counts on screen are known to be wrong.
    previewing = true;
    try {
      // The preview never writes, and the server ignores expectedFaceCount on this path — the DTO requires a
      // number, so send the last one we knew about.
      const result = await previewDissolvePerson({
        personId,
        dissolveRequestDto: buildRequest(preview?.expectedFaceCount ?? 0),
      });
      if (token === previewToken) {
        preview = result;
        previewing = false;
      }
    } catch (error) {
      if (token === previewToken) {
        // `previewing` stays true, so the destructive button stays disabled: with no count to send back there
        // is nothing safe to apply.
        handleError(error, $t('errors.unable_to_load_faces'));
      }
    }
  };

  const schedulePreview = () => {
    previewing = true;
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => void runPreview(), PREVIEW_DEBOUNCE_MS);
  };

  const selectScope = (value: DissolveScope) => {
    scope = value;
    schedulePreview();
  };

  const selectOutcome = (value: DissolveOutcome) => {
    outcome = value;
    schedulePreview();
  };

  const toggleRedetect = (event: Event) => {
    redetectWhenUnassigning = (event.currentTarget as HTMLInputElement).checked;
    schedulePreview();
  };

  const apply = async () => {
    if (!preview || !canApply) {
      return;
    }

    applying = true;
    try {
      // Verbatim from the preview. It is the server's concurrency guard: a count that moved since the preview
      // is a 409 and nothing is written, so recomputing it here would defeat the guard.
      await dissolvePerson({ personId, dissolveRequestDto: buildRequest(preview.expectedFaceCount) });
      onClose(true);
    } catch (error) {
      handleError(error, $t('errors.something_went_wrong'));
      // On a 409 the faces moved under us; re-previewing is what makes a second attempt possible at all.
      await runPreview();
    } finally {
      applying = false;
    }
  };

  onMount(() => void runPreview().catch(() => null));
  onDestroy(() => clearTimeout(debounceHandle));
</script>

<Modal title={$t('admin.face_cleanup_dissolve')} size="large" onClose={() => onClose(false)}>
  <ModalBody>
    <div class="flex flex-col gap-5 py-2">
      <!-- Scope: chip buttons, never a <select bind:value>, which resets itself on re-render. -->
      <div class="flex flex-wrap gap-2" data-testid="dissolve-scopes">
        {#each SCOPES as option (option.value)}
          <button
            type="button"
            aria-pressed={scope === option.value}
            onclick={() => selectScope(option.value)}
            class="rounded-full border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-500 transition-colors hover:bg-gray-100 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            {$t(option.label)}
          </button>
        {/each}
      </div>

      <div
        class="grid grid-cols-2 gap-3 rounded-2xl border border-gray-200 p-4 sm:grid-cols-4 dark:border-gray-700"
        data-testid="dissolve-counts"
      >
        {#each countCells as cell (cell.key)}
          <div data-testid="dissolve-count-{cell.key}">
            <div class="text-lg font-semibold tabular-nums">
              {cell.value === undefined ? '—' : cell.value.toLocaleString()}
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">{$t(cell.label)}</div>
          </div>
        {/each}
      </div>

      {#if warnings.length > 0}
        <ul class="flex flex-col gap-2" data-testid="dissolve-warnings">
          {#each warnings as warning (warning.code)}
            <li
              class="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/30 dark:bg-amber-900/10 dark:text-amber-300"
              data-testid="dissolve-warning-{warning.code}"
            >
              {$t(warning.key, { values: { count: warning.count } })}
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Outcome: native radios, so the group is one tab stop and reads as a choice to a screen reader. -->
      <fieldset class="flex flex-col gap-2">
        <legend class="sr-only">{$t('admin.face_cleanup_dissolve')}</legend>
        {#each OUTCOMES as option (option.value)}
          <label class="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="dissolve-outcome"
              value={option.value}
              checked={outcome === option.value}
              onchange={() => selectOutcome(option.value)}
            />
            {$t(option.label)}
          </label>
        {/each}
      </fieldset>

      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={redetect} disabled={isDelete} onchange={toggleRedetect} />
        {$t('admin.face_cleanup_dissolve_redetect')}
      </label>

      <div class="flex flex-col gap-2">
        <label class="text-sm font-semibold" for="dissolve-confirmation">
          {$t('admin.face_cleanup_dissolve_confirm', { values: { name: personName } })}
        </label>
        <input
          id="dissolve-confirmation"
          type="text"
          autocomplete="off"
          bind:value={confirmation}
          class="rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-sm dark:border-gray-700"
        />
      </div>
    </div>
  </ModalBody>

  <ModalFooter>
    <div class="flex w-full justify-end gap-2">
      <Button shape="round" color="secondary" onclick={() => onClose(false)}>{$t('cancel')}</Button>
      <Button shape="round" color="danger" disabled={!canApply} onclick={apply}>{$t(outcomeLabel)}</Button>
    </div>
  </ModalFooter>
</Modal>
