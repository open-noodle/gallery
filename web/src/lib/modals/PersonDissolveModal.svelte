<script lang="ts">
  import { handleError } from '$lib/utils/handle-error';
  import { dissolvePerson, previewDissolvePerson } from '@immich/sdk';
  import type { DissolveRequestDto, DissolveResponseDto } from '@immich/sdk';
  import { Button, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { onDestroy, onMount } from 'svelte';
  import { t, type Translations } from 'svelte-i18n';

  // A generated ENUM, whose members are exactly these strings at runtime; `${...}` widens it to that literal
  // union. Deliberate: an enum is a runtime VALUE, so importing it would break any spec that stubs
  // `@immich/sdk` with a factory mock of just the two endpoints. buildRequest is where the two meet.
  type DissolveScope = `${DissolveRequestDto['scope']}`;

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

  // Contract with buildWarnings() in face-dissolve.service.ts — those five codes and no others. Typed
  // `Translations`, not `string`: `$t` only accepts keys that exist in en.json, so a typo here is a build
  // error rather than a raw key rendered at an admin. An unknown code renders nothing at all.
  const WARNING_KEY_BY_CODE: Record<string, Translations | undefined> = {
    'not-redetectable': 'admin.face_cleanup_dissolve_warn_not_redetectable',
    'shared-assets': 'admin.face_cleanup_dissolve_warn_shared_assets',
    'metadata-import-on': 'admin.face_cleanup_dissolve_warn_metadata_import_on',
    'hand-drawn-kept': 'admin.face_cleanup_dissolve_warn_hand_drawn_kept',
    'space-persons-kept': 'admin.face_cleanup_dissolve_warn_space_persons_kept',
  };

  const PREVIEW_DEBOUNCE_MS = 250;

  // `exif` by default, not `all`: on a real person polluted by imported faces, `all` would also hide every real
  // detected face. Hiding can be restored, deleting imported faces cannot; widening to `all` (a junk cluster) is
  // one click.
  let scope = $state<DissolveScope>('exif');
  let preview = $state<DissolveResponseDto | null>(null);
  // True from mount until the first preview lands, and again while a control change is unaccounted for. The
  // counts are the only thing between an admin and an irreversible delete, so applying while they describe a
  // selection other than the current one is exactly what this gate exists to prevent.
  let previewing = $state(true);
  let confirmation = $state('');
  let applying = $state(false);

  // The length check is not redundant: a blank `personName` would otherwise make an empty box "match" and hand
  // an irreversible delete a gate that is already open.
  const expectedName = $derived(personName.trim().toLowerCase());
  const nameConfirmed = $derived(expectedName.length > 0 && confirmation.trim().toLowerCase() === expectedName);
  const canApply = $derived(nameConfirmed && preview !== null && !previewing && !applying);

  // Gated on `previewing`, which means "what is on screen does not describe the current selection" — it is
  // set the moment a chip is clicked and only cleared by a preview that LANDS. A failed preview therefore
  // leaves `preview` holding the PREVIOUS scope's response, and without this gate the panel renders those
  // numbers under the newly highlighted chip: the dialog then confidently describes a different face set
  // than the one the button would delete, on an operation with no undo. Blank beats wrong here.
  const warnings = $derived(
    previewing
      ? []
      : (preview?.warnings ?? [])
          .map(({ code, count }) => ({ code, count, key: WARNING_KEY_BY_CODE[code] }))
          .filter((warning): warning is { code: string; count: number; key: Translations } => !!warning.key),
  );

  // Face-level counts first, then photo-level ones. `notRedetectable` earns its cell even though its warning
  // repeats the number: it is the one part of the blast radius that no re-scan can put back.
  const countCells = $derived([
    { key: 'faces', label: 'admin.face_cleanup_col_faces' as Translations, value: preview?.counts.faces },
    { key: 'hide', label: 'admin.face_cleanup_dissolve_scope_ml' as Translations, value: preview?.counts.hide },
    { key: 'delete', label: 'admin.face_cleanup_dissolve_scope_exif' as Translations, value: preview?.counts.delete },
    { key: 'keep', label: 'admin.face_cleanup_dissolve_count_kept' as Translations, value: preview?.counts.keep },
    { key: 'assets', label: 'photos' as Translations, value: preview?.counts.assets },
    {
      key: 'not-redetectable',
      label: 'admin.face_cleanup_dissolve_count_not_redetectable' as Translations,
      value: preview?.counts.notRedetectable,
    },
  ]);

  // What the dissolve does, in words, split by whether a restore from the Dissolved page can undo it. The admin
  // must see the permanent part before typing the name: deleted imported faces, the person itself (its name and
  // birthday) and emptied Space people are never brought back, while hidden faces are.
  const counts = $derived(previewing ? undefined : preview?.counts);
  const undoable = $derived(
    counts && counts.hide > 0
      ? [{ key: 'hide', text: $t('admin.face_cleanup_dissolve_hide_count', { values: { count: counts.hide } }) }]
      : [],
  );
  const permanent = $derived(
    counts
      ? [
          counts.delete > 0 && {
            key: 'delete',
            testId: 'dissolve-treatment-delete',
            text: $t('admin.face_cleanup_dissolve_delete_count', { values: { count: counts.delete } }),
          },
          counts.personRemoved && {
            key: 'person',
            testId: 'dissolve-person-outcome',
            text: $t('admin.face_cleanup_dissolve_person_removed'),
          },
          counts.spacePersonsRemoved > 0 && {
            key: 'space-persons',
            testId: 'dissolve-space-persons-removed',
            text: $t('admin.face_cleanup_dissolve_space_persons_removed', {
              values: { count: counts.spacePersonsRemoved },
            }),
          },
        ].filter((item): item is { key: string; testId: string; text: string } => !!item)
      : [],
  );

  const buildRequest = (expectedFaceCount: number): DissolveRequestDto => ({
    scope: scope as DissolveRequestDto['scope'],
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
              {cell.value === undefined || previewing ? '—' : cell.value.toLocaleString()}
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

      {#if undoable.length > 0}
        <section
          class="rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-gray-700"
          data-testid="dissolve-undoable"
        >
          <h3 class="font-semibold">{$t('admin.face_cleanup_dissolve_undoable_heading')}</h3>
          <ul class="mt-1 flex flex-col gap-1">
            {#each undoable as item (item.key)}
              <li data-testid="dissolve-treatment-{item.key}">{item.text}</li>
            {/each}
          </ul>
          <p class="mt-1 text-gray-500 dark:text-gray-400" data-testid="dissolve-real-faces-note">
            {$t('admin.face_cleanup_dissolve_real_faces_note')}
          </p>
        </section>
      {/if}

      {#if permanent.length > 0}
        <section
          class="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-300"
          data-testid="dissolve-permanent"
        >
          <h3 class="font-semibold">{$t('admin.face_cleanup_dissolve_permanent_heading')}</h3>
          <ul class="mt-1 flex flex-col gap-1">
            {#each permanent as item (item.key)}
              <li data-testid={item.testId}>{item.text}</li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if counts && (counts.keep > 0 || !counts.personRemoved)}
        <ul class="flex flex-col gap-1 text-sm">
          {#if counts.keep > 0}
            <li data-testid="dissolve-treatment-unassign">
              {$t('admin.face_cleanup_dissolve_unassign_count', { values: { count: counts.keep } })}
            </li>
          {/if}
          {#if !counts.personRemoved}
            <li data-testid="dissolve-person-outcome">
              {$t('admin.face_cleanup_dissolve_person_kept', { values: { count: counts.remainingFaces } })}
            </li>
          {/if}
        </ul>
      {/if}

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
      <Button shape="round" color="danger" disabled={!canApply} onclick={apply}
        >{$t('admin.face_cleanup_dissolve_apply')}</Button
      >
    </div>
  </ModalFooter>
</Modal>
