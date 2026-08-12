<script lang="ts">
  import { Button, Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import type { Translations } from 'svelte-i18n';
  import { bodyKeyFor, effectKeyFor, FACE_ACTIONS, type FaceActionId, type FaceReviewMode } from './face-actions';

  // ONE modal for both modes (design §3.3), replacing guided's ActionsHelpModal and manual's
  // ManualActionsHelpModal. The two used to be a deliberate fork because their action SETS differ — but the
  // sets are just a prop, and forking the component meant forking every future fix to it as well.
  //
  // What genuinely does differ is three explanations (see face-actions.ts `ModalKey`), and those are resolved
  // per mode rather than collapsed. The action NAME is never re-declared here: each row reuses the button's own
  // label key, so a translated heading can never drift from its translated button.

  interface Props {
    mode: FaceReviewMode;
    actions: FaceActionId[];
    introKey: Translations;
    footerKey: Translations;
    /** Renders a "(default)" badge on this action. Manual passes `keep`; guided passes nothing. */
    defaultActionId?: FaceActionId;
    onClose: () => void;
  }

  const { mode, actions, introKey, footerKey, defaultActionId, onClose }: Props = $props();
</script>

<Modal title={$t('admin.face_cleanup_review_help_title')} icon={mdiInformationOutline} {onClose} size="medium">
  <ModalBody>
    <p class="text-sm/relaxed text-gray-600 dark:text-gray-300">{$t(introKey)}</p>

    <div class="mt-2 flex flex-col" data-testid="help-actions">
      {#if actions.length > 0}
        <!-- Guarding the `{#each}` with an `{#if}` isn't just style: happy-dom represents an EMPTY each
             block's own anchor as an empty text node rather than a comment node, so
             `toBeEmptyDOMElement()` (which only ignores comment nodes) reports a false positive for
             "not empty" on a zero-action render unless the each never mounts at all. -->
        {#each actions as id (id)}
          {@const meta = FACE_ACTIONS[id]}
          <div
            class="flex gap-3.5 border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700"
            data-testid={`help-row-${id}`}
          >
            {#if meta.swatchColor}
              <span
                class="w-[3px] flex-none rounded-full"
                style={`background: ${meta.swatchColor}`}
                data-testid={`help-swatch-${id}`}
              ></span>
            {:else}
              <!-- No rail: `keep` and `unmark` correspond to no coloured tile state, and are signalled by
                   absence exactly as an untouched tile carries no badge or ribbon. -->
              <span class="w-[3px] flex-none rounded-full"></span>
            {/if}

            <div>
              <h3 class="flex items-center gap-2 text-sm font-bold">
                {#if meta.swatchColor && meta.buttonIcon}
                  <Icon icon={meta.buttonIcon} size="15" color={meta.swatchColor} />
                {/if}
                {$t(meta.labelKey)}
                {#if id === defaultActionId}
                  <span class="text-xs font-normal text-gray-400 dark:text-gray-500" data-testid="help-default-badge">
                    ({$t('admin.face_cleanup_manual_review_help_default_badge')})
                  </span>
                {/if}
              </h3>

              <p class="mt-1.5 text-sm/relaxed">{$t(bodyKeyFor(id, mode))}</p>

              <p
                class="mt-2 border-l-2 border-gray-200 pl-3 text-sm/relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400"
                data-testid="help-effect"
              >
                <b class="font-bold text-gray-700 dark:text-gray-200">
                  {$t('admin.face_cleanup_review_help_effect_label')}
                </b>
                {$t(effectKeyFor(id, mode))}
              </p>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <p class="mt-4 text-xs/relaxed text-gray-500 dark:text-gray-400" data-testid="help-footer">{$t(footerKey)}</p>
  </ModalBody>

  <ModalFooter>
    <Button shape="round" fullWidth onclick={onClose} data-testid="help-close">{$t('close')}</Button>
  </ModalFooter>
</Modal>
