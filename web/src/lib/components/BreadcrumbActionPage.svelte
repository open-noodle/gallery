<script lang="ts">
  import type { HeaderButtonActionItem } from '$lib/types';
  import {
    Breadcrumbs,
    Button,
    Container,
    ContextMenuButton,
    HStack,
    MenuItemType,
    Scrollable,
    isMenuItemType,
    type BreadcrumbItem,
  } from '@immich/ui';
  import { mdiSlashForward } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  type Props = {
    breadcrumbs?: BreadcrumbItem[];
    actions?: Array<HeaderButtonActionItem | MenuItemType>;
    children?: Snippet;
    // Optional action bar pinned to the bottom of the content region, OUTSIDE the scroll area. A page that needs
    // one cannot get it with `position: sticky` from inside `children`: the sticky element's containing block is
    // the auto-height Container below, which never reaches the bottom of the scrollport, so on a short page the
    // bar has no travel and simply lands wherever the content happens to end — adrift in the middle of the page.
    // Rendering it as a sibling of the Scrollable pins it for free, at any content length, and the scroll area
    // shrinks to fit above it instead of the content sliding underneath.
    footer?: Snippet;
  };

  let { breadcrumbs = [], actions = [], children, footer }: Props = $props();

  const enabledActions = $derived(
    actions
      .filter((action): action is HeaderButtonActionItem => !isMenuItemType(action))
      .filter((action) => action.$if?.() ?? true),
  );
</script>

<div class="flex h-full flex-col">
  <div class="flex h-16 w-full items-center justify-between border-b px-4 py-2 md:px-2" data-testid="admin-page-header">
    <Breadcrumbs items={breadcrumbs} separator={mdiSlashForward} />

    {#if enabledActions.length > 0}
      <div class="hidden md:block">
        <HStack gap={0}>
          {#each enabledActions as action, i (i)}
            <Button
              variant="ghost"
              size="small"
              color={action.color ?? 'secondary'}
              leadingIcon={action.icon}
              onclick={() => action.onAction(action)}
              title={action.data?.title}
            >
              {action.title}
            </Button>
          {/each}
        </HStack>
      </div>

      <ContextMenuButton aria-label={$t('open')} items={actions} class="md:hidden" />
    {/if}
  </div>
  <Scrollable class="grow">
    <Container class="p-2 pb-16" {children} />
  </Scrollable>
  <!-- No wrapper element: a page that passes no footer (or whose footer renders nothing) adds nothing to the
       DOM, so the 16 other admin pages are untouched. The footer supplies its own border/background. -->
  {@render footer?.()}
</div>
