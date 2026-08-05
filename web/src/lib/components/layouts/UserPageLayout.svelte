<script lang="ts" module>
  export const headerId = 'user-page-header';
</script>

<script lang="ts">
  import { useActions, type ActionArray } from '$lib/actions/use-actions';
  import NavigationBar from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';
  import UserSidebar from '$lib/components/shared-components/side-bar/UserSidebar.svelte';
  import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';
  import type { HeaderButtonActionItem } from '$lib/types';
  import { openFileUploadDialog } from '$lib/utils/file-uploader';
  import { Button, ContextMenuButton, HStack, isMenuItemType, type MenuItemType } from '@immich/ui';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    hideNavbar?: boolean;
    title?: string | undefined;
    description?: string | undefined;
    scrollbar?: boolean;
    use?: ActionArray;
    actions?: Array<HeaderButtonActionItem | MenuItemType>;
    leading?: Snippet;
    descriptionTrailing?: Snippet;
    sidebar?: Snippet;
    buttons?: Snippet;
    children?: Snippet;
  }

  let {
    hideNavbar = false,
    title = undefined,
    description = undefined,
    scrollbar = true,
    use = [],
    actions = [],
    leading,
    descriptionTrailing,
    sidebar,
    buttons,
    children,
  }: Props = $props();

  const enabledActions = $derived(
    actions
      .filter((action): action is HeaderButtonActionItem => !isMenuItemType(action))
      .filter((action) => action.$if?.() ?? true),
  );

  let scrollbarClass = $derived(scrollbar ? 'immich-scrollbar' : 'scrollbar-hidden');
  let hasHeaderRow = $derived(!!(title || buttons));
  let hasTitleClass = $derived(hasHeaderRow ? 'top-16 h-[calc(100%-(--spacing(16)))]' : 'top-0 h-full');

  // /tags and /folders supply a tree explorer wrapping upstream Sidebar.svelte, which is
  // always 16rem above 850px. Collapsing their grid column to the rail width would clip it,
  // and a tag tree has no meaningful icon-only form, so those pages opt out of the rail.
  const sidebarWidth = $derived.by(() => {
    if (sidebar) {
      return sidebarModeStore.layout === 'overlay' ? '0' : 'expanded';
    }
    return sidebarModeStore.layout === 'overlay' ? '0' : sidebarModeStore.layout;
  });

  const sidebarWidthValue = $derived(
    { '0': '0px', rail: 'calc(var(--spacing) * 20)', expanded: 'calc(var(--spacing) * 64)' }[sidebarWidth],
  );
</script>

<header>
  {#if !hideNavbar}
    <NavigationBar onUploadClick={() => openFileUploadDialog()} railAware={!sidebar} />
  {/if}
</header>
<!-- The two height sources are not interchangeable: with a navbar the grid sits *below* a real
     4rem element, so it subtracts --navbar-height; with `hideNavbar` the page floats an 80px
     ControlAppBar over itself instead and pads by --control-bar-height to clear it.

     The reserve gets the content panel's 8px chrome gutter added to it. The panel drops its top
     margin so the navbar can own that gutter and centre its search field in the band the two of
     them form (see --navbar-height), but a hidden navbar owns nothing - the reserve is all that
     stands between the panel and an 80px bar it would otherwise slide under, since the reserve
     is 76px and only ever cleared the bar with the panel's margin on top of it. The literal
     matches the gutter in gallery-theme.css; --control-bar-height itself cannot absorb it,
     because the album, person, partner and shared-link viewers spend it on full-bleed <main>
     elements that never had the margin. -->
<div
  tabindex="-1"
  data-testid="user-page-grid"
  data-sidebar-width={sidebarWidth}
  style:--sidebar-width={sidebarWidthValue}
  class="relative z-0 grid grid-cols-[var(--sidebar-width)_auto] overflow-hidden
    {hideNavbar ? 'h-dvh' : 'h-[calc(100dvh-var(--navbar-height))] max-md:h-[calc(100dvh-var(--navbar-height-md))]'}
    {hideNavbar ? 'pt-[calc(var(--control-bar-height)+8px)]' : ''}
    {hideNavbar ? 'max-md:pt-[calc(var(--control-bar-height-md)+8px)]' : ''}"
>
  {#if sidebar}
    {@render sidebar()}
  {:else}
    <UserSidebar />
  {/if}

  <main class="relative">
    <div class="{scrollbarClass} absolute {hasTitleClass} w-full overflow-y-auto p-2" use:useActions={use}>
      {@render children?.()}
    </div>

    {#if !hideNavbar && (title || buttons)}
      <div class="absolute flex h-16 w-full place-items-center justify-between border-b p-2 text-dark">
        <div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" data-testid="page-header-title-row">
          {@render leading?.()}
          {#if title}
            <div class="min-w-0 truncate pe-8 outline-none" tabindex="-1" id={headerId} data-testid="page-header">
              {title}
            </div>
          {/if}
          {#if description}
            <p
              class="shrink-0 text-sm whitespace-nowrap text-gray-400 dark:text-gray-600"
              data-testid="page-header-description"
            >
              {description}
            </p>
          {/if}
          {#if descriptionTrailing}
            <div class="shrink-0" data-testid="page-header-description-trailing">
              {@render descriptionTrailing()}
            </div>
          {/if}
        </div>

        {@render buttons?.()}

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
    {/if}
  </main>
</div>
