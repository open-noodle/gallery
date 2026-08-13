<script lang="ts">
  import { initInput } from '$lib/actions/focus';
  import AlbumListItem from '$lib/components/asset-viewer/AlbumListItem.svelte';
  import NewAlbumListItem from '$lib/components/shared-components/album-selection/NewAlbumListItem.svelte';
  import {
    albumToCollection,
    CollectionModalRowConverter,
    CollectionModalRowType,
    collectionKey,
    isSelectableRowType,
    isValidNewSpaceName,
    isWritableSpace,
    pickRecent,
    spaceToCollection,
    type CollectionModalRow,
    type PickerCollection,
  } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
  import NewSpaceListItem from '$lib/components/shared-components/collection-selection/new-space-list-item.svelte';
  import SpaceListItem from '$lib/components/shared-components/collection-selection/space-list-item.svelte';
  import SpacePoolListItem from '$lib/components/shared-components/collection-selection/space-pool-list-item.svelte';
  import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createAlbum,
    createSpace,
    getAllAlbums,
    getAllSpaces,
    getSharedSpaceAlbums,
    type AlbumResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import { mdiImageMultipleOutline, mdiInformationOutline, mdiKeyboardReturn } from '@mdi/js';
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { t } from 'svelte-i18n';

  interface Props {
    assetCount: number;
    onClose: (collections?: PickerCollection[]) => void;
    /**
     * Restrict the picker to albums linked to this space. Set when the selection contains
     * assets the user does not own: those can only land as #764 space contributions
     * (`album_space_asset`), which the server accepts solely for albums linked to a space
     * where the caller is Owner/Editor. Personal albums, brand-new albums and space pools
     * would all silently drop them, so none are offered.
     */
    restrictToSpaceId?: string;
  }

  let { assetCount, onClose, restrictToSpaceId }: Props = $props();

  let albums = $state<AlbumResponseDto[]>([]);
  let spaces = $state<SharedSpaceResponseDto[]>([]);
  let loading = $state(true);
  let search = $state('');
  let selectedRowIndex = $state(-1);
  const multiSelectedKeys = $state<string[]>([]);
  const multiSelectActive = $derived(multiSelectedKeys.length > 0);

  const restricted = $derived(restrictToSpaceId !== undefined);
  const showSpaces = $derived(!restricted && assetCount <= MAX_SPACE_ASSETS_PER_REQUEST);
  const currentUserId = $derived(authManager.authenticated ? (authManager.user?.id ?? null) : null);

  const albumCollections = $derived(albums.map((a) => albumToCollection(a)));
  const spaceCollections = $derived(
    showSpaces ? spaces.filter((space) => isWritableSpace(space, currentUserId)).map((s) => spaceToCollection(s)) : [],
  );
  const allCollections = $derived([...albumCollections, ...spaceCollections]);

  const recentCollections = $derived(pickRecent(allCollections, 3));

  // #965: the linked albums of the one expanded space. Fetched lazily on expand and kept for
  // the life of the modal, so re-opening a space costs nothing and opening the picker still
  // costs exactly two requests however many spaces the user is in.
  let expandedSpaceId = $state<string | null>(null);
  let spaceAlbumCache = $state<Record<string, PickerCollection[]>>({});
  // Guards duplicate requests; nothing renders from it. `SvelteSet` rather than a plain `Set`
  // because svelte/prefer-svelte-reactivity forbids mutable built-in Sets in components.
  const spaceAlbumsInFlight = new SvelteSet<string>();
  const expandedSpaceAlbums = $derived(expandedSpaceId === null ? undefined : spaceAlbumCache[expandedSpaceId]);

  const converter = new CollectionModalRowConverter();
  const rows = $derived(
    converter.toModalRows(search, recentCollections, allCollections, selectedRowIndex, multiSelectedKeys, {
      showSpaces,
      allowCreate: !restricted,
      // Restricted mode never lists spaces, so the default "no albums or spaces" wording
      // would name a collection type that was never on offer.
      emptyText: restricted ? $t('no_albums_in_space_yet') : undefined,
      noMatchText: restricted ? $t('no_albums_found') : undefined,
      expandedSpaceId,
      expandedSpaceAlbums,
    }),
  );
  const selectableRowCount = $derived(rows.filter((row) => isSelectableRowType(row.type)).length);

  onMount(async () => {
    if (restrictToSpaceId) {
      try {
        await loadSpaceAlbums(restrictToSpaceId);
      } catch (error) {
        handleError(error, $t('errors.unable_to_load_albums'));
      }
      loading = false;
      return;
    }

    const [albumResult, spaceResult] = await Promise.allSettled([loadAlbums(), loadSpaces()]);
    if (albumResult.status === 'rejected') {
      handleError(albumResult.reason, $t('errors.unable_to_load_albums'));
    }
    if (spaceResult.status === 'rejected') {
      handleError(spaceResult.reason, $t('failed_to_load_spaces'));
    }
    loading = false;
  });

  const loadAlbums = async () => {
    const owned = await getAllAlbums({ isOwned: true });
    owned.push(...(await getAllAlbums({ isShared: true })));
    albums = owned;
  };

  // `SharedSpaceLinkedAlbumDto` is `AlbumResponseDto` minus `albumUsers` (plus link metadata),
  // so shim the missing field back in for AlbumListItem. The membership list is unused here.
  const fetchSpaceAlbums = async (spaceId: string): Promise<AlbumResponseDto[]> => {
    const linked = await getSharedSpaceAlbums({ id: spaceId });
    return linked.map((album) => ({ ...album, albumUsers: [] }) as AlbumResponseDto);
  };

  const loadSpaceAlbums = async (spaceId: string) => {
    albums = await fetchSpaceAlbums(spaceId);
  };

  /**
   * Open a space's linked albums, or close them again.
   *
   * Accordion, like mobile: at most one space is open, so the row list stays short and only
   * one space's albums are ever in memory. A failed fetch collapses the row rather than
   * leaving it stuck open on a spinner that will never resolve.
   */
  const toggleSpaceExpansion = async (collection: PickerCollection) => {
    if (collection.kind !== 'space') {
      return;
    }
    expandedSpaceId = expandedSpaceId === collection.id ? null : collection.id;
    // Toggling inserts or removes rows, so every index after this space shifts. Re-anchor the
    // caret on the space row itself — leaving it where it was would point at a different row,
    // and clearing it would strand a keyboard user who has to walk the list again to reach the
    // children they just revealed.
    reanchorCaretOnSpace(collection.id);
    if (expandedSpaceId !== collection.id || Object.hasOwn(spaceAlbumCache, collection.id)) {
      return; // collapsed, or already fetched once this modal was opened
    }
    if (spaceAlbumsInFlight.has(collection.id)) {
      return; // a collapse/re-expand while the first request is still out
    }
    spaceAlbumsInFlight.add(collection.id);
    try {
      const linked = await fetchSpaceAlbums(collection.id);
      spaceAlbumCache[collection.id] = linked.map((album) => albumToCollection(album));
    } catch (error) {
      handleError(error, $t('errors.unable_to_load_albums'));
      if (expandedSpaceId === collection.id) {
        expandedSpaceId = null;
      }
    } finally {
      spaceAlbumsInFlight.delete(collection.id);
    }
  };

  /**
   * Put the arrow-key caret back on a space row after its children appeared or disappeared.
   *
   * Only when the caret was already in use — a mouse user who clicks a row should not suddenly
   * acquire a keyboard selection highlight. `rows` is `$derived`, so reading it here sees the
   * post-toggle list.
   */
  const reanchorCaretOnSpace = (spaceId: string) => {
    if (selectedRowIndex === -1) {
      return;
    }
    let index = -1;
    for (const row of rows) {
      if (!isSelectableRowType(row.type)) {
        continue;
      }
      index++;
      if (row.type === CollectionModalRowType.COLLECTION_ITEM && row.collection?.id === spaceId) {
        selectedRowIndex = index;
        return;
      }
    }
    selectedRowIndex = -1;
  };

  const loadSpaces = async () => {
    spaces = await getAllSpaces();
  };

  /**
   * Resolve a multi-select key back to its collection.
   *
   * Must search the fetched space albums too, not just `allCollections`: a space-linked album
   * owned by another member has no `album_user` row for the caller, so `getAllAlbums` never
   * returns it — which is precisely the #965 case. Missing it here made `submitMulti` resolve
   * the key to `undefined`, drop it, and close the modal as if the user had cancelled.
   */
  const findByKey = (key: string) =>
    [...allCollections, ...Object.values(spaceAlbumCache).flat()].find(
      (collection) => collectionKey(collection) === key,
    );

  const toggleMultiSelect = (collection?: PickerCollection) => {
    const target = collection ?? rows.find((row) => row.selected)?.collection;
    if (!target) {
      return;
    }
    const key = collectionKey(target);
    const index = multiSelectedKeys.indexOf(key);
    if (index === -1) {
      multiSelectedKeys.push(key);
    } else {
      multiSelectedKeys.splice(index, 1);
    }
  };

  const handleCollectionClick = (collection: PickerCollection) => {
    if (multiSelectActive) {
      toggleMultiSelect(collection);
      return;
    }
    onClose([collection]);
  };

  /**
   * What clicking a space row's body does. An expandable one opens instead of picking — its
   * pool stays reachable as the "Add to space" child, and via the row's own checkbox.
   */
  const handleSpaceClick = (row: CollectionModalRow, collection: PickerCollection) =>
    row.expandable ? void toggleSpaceExpansion(collection) : handleCollectionClick(collection);

  const submitMulti = () => {
    const selected = multiSelectedKeys
      .map((key) => findByKey(key))
      .filter((collection): collection is PickerCollection => collection !== undefined);
    onClose(selected.length > 0 ? selected : undefined);
  };

  const onNewAlbum = async (name: string) => {
    name = name.trim();
    try {
      const album = await createAlbum({ createAlbumDto: { albumName: name } });
      eventManager.emit('AlbumCreate', album);
      onClose([albumToCollection(album)]);
    } catch (error) {
      handleError(error, $t('errors.failed_to_create_album'));
    }
  };

  const onNewSpace = async (name: string) => {
    if (!isValidNewSpaceName(name)) {
      return;
    }
    try {
      const space = await createSpace({ sharedSpaceCreateDto: { name: name.trim() } });
      onClose([spaceToCollection(space)]);
    } catch (error) {
      handleError(error, $t('errors.failed_to_create_space'));
    }
  };

  const onEnter = async () => {
    const item = rows.find((row) => row.selected);
    if (!item) {
      return;
    }
    switch (item.type) {
      case CollectionModalRowType.NEW_ALBUM: {
        await onNewAlbum(search.trim());
        break;
      }
      case CollectionModalRowType.NEW_SPACE: {
        if (isValidNewSpaceName(search)) {
          await onNewSpace(search);
        }
        break;
      }
      case CollectionModalRowType.COLLECTION_ITEM:
      case CollectionModalRowType.SPACE_POOL_CHILD: {
        if (item.expandable && item.collection) {
          await toggleSpaceExpansion(item.collection);
          return; // toggling re-anchored the caret on the space row; don't clear it below
        }
        if (multiSelectActive) {
          submitMulti();
        } else if (item.collection) {
          onClose([item.collection]);
        }
        break;
      }
      case CollectionModalRowType.SECTION:
      case CollectionModalRowType.MESSAGE: {
        // Section headers and informational rows are never selectable, so Enter is a no-op.
        break;
      }
    }
    selectedRowIndex = -1;
  };

  const onkeydown = async (event: KeyboardEvent) => {
    // Called synchronously for every handled key, before any `await` can suspend the
    // handler — otherwise preventDefault() is a no-op (unicorn/no-late-event-control).
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Control'].includes(event.key)) {
      event.preventDefault();
    }
    switch (event.key) {
      case 'ArrowUp': {
        selectedRowIndex = selectedRowIndex > 0 ? selectedRowIndex - 1 : selectableRowCount - 1;
        break;
      }
      case 'ArrowDown': {
        selectedRowIndex = selectedRowIndex < selectableRowCount - 1 ? selectedRowIndex + 1 : 0;
        break;
      }
      case 'Enter': {
        await onEnter();
        break;
      }
      case 'Control': {
        toggleMultiSelect();
        break;
      }
      default: {
        selectedRowIndex = -1;
      }
    }
  };
</script>

<Modal title={$t('add_to_album_or_space')} {onClose} size="medium">
  <ModalBody>
    <div class="mb-2 flex max-h-144 flex-col">
      {#if loading}
        <!-- eslint-disable-next-line svelte/require-each-key -->
        {#each { length: 3 } as _}
          <div class="flex animate-pulse gap-4 px-6 py-2">
            <div class="size-12 rounded-xl bg-slate-200"></div>
            <div class="flex flex-col items-start justify-center gap-2">
              <span class="h-4 w-36 animate-pulse bg-slate-200"></span>
              <span class="h-3 w-20 animate-pulse bg-slate-200"></span>
            </div>
          </div>
        {/each}
      {:else}
        <input
          class="border-b-4 border-immich-bg px-6 py-2 text-2xl focus:border-immich-primary dark:border-immich-dark-gray dark:focus:border-immich-dark-primary"
          placeholder={$t('search')}
          {onkeydown}
          bind:value={search}
          use:initInput
        />
        {#if restricted}
          <div
            class="flex items-center gap-2 px-6 py-2 text-sm text-gray-500 dark:text-gray-400"
            data-testid="restricted-to-space-notice"
          >
            <Icon icon={mdiInformationOutline} size="1rem" />
            <span>{$t('add_to_collection_restricted_to_space')}</span>
          </div>
        {:else if !showSpaces}
          <div
            class="flex items-center gap-2 px-6 py-2 text-sm text-gray-500 dark:text-gray-400"
            data-testid="spaces-hidden-notice"
          >
            <Icon icon={mdiInformationOutline} size="1rem" />
            <span>{$t('spaces_hidden_too_many_assets', { values: { count: MAX_SPACE_ASSETS_PER_REQUEST } })}</span>
          </div>
        {/if}
        <div class="immich-scrollbar overflow-y-auto">
          <!-- eslint-disable-next-line svelte/require-each-key -->
          {#each rows as row}
            {#if row.type === CollectionModalRowType.NEW_ALBUM}
              <NewAlbumListItem selected={row.selected || false} {onNewAlbum} searchQuery={search} />
            {:else if row.type === CollectionModalRowType.NEW_SPACE}
              <NewSpaceListItem selected={row.selected || false} {onNewSpace} searchQuery={search} />
            {:else if row.type === CollectionModalRowType.SECTION}
              <p class="px-5 py-3 text-xs">{row.text}</p>
            {:else if row.type === CollectionModalRowType.MESSAGE}
              <!-- ps-11 lines the child up with the album children's thumbnails (ps-9 wrapper + p-2). -->
              <p class={['py-1 text-sm', row.indented ? 'ps-11 pe-5' : 'px-5']}>{row.text}</p>
            {:else if row.type === CollectionModalRowType.SPACE_POOL_CHILD && row.collection}
              {@const collection = row.collection}
              <SpacePoolListItem
                spaceId={collection.id}
                selected={row.selected || false}
                multiSelected={row.multiSelected}
                onClick={() => handleCollectionClick(collection)}
                onMultiSelect={() => toggleMultiSelect(collection)}
              />
            {:else if row.type === CollectionModalRowType.COLLECTION_ITEM && row.collection}
              {@const collection = row.collection}
              <div data-testid={`row-${collection.kind}-${collection.id}`} class={{ 'ps-9': row.indented }}>
                {#if collection.kind === 'album'}
                  <AlbumListItem
                    album={collection.album}
                    selected={row.selected || false}
                    multiSelected={row.multiSelected}
                    searchQuery={search}
                    badgeIcon={mdiImageMultipleOutline}
                    onAlbumClick={() => handleCollectionClick(collection)}
                    onMultiSelect={() => toggleMultiSelect(collection)}
                  />
                {:else}
                  <SpaceListItem
                    space={collection.space}
                    selected={row.selected || false}
                    multiSelected={row.multiSelected}
                    expandable={row.expandable}
                    expanded={row.expanded}
                    searchQuery={search}
                    onSpaceClick={() => handleSpaceClick(row, collection)}
                    onMultiSelect={() => toggleMultiSelect(collection)}
                  />
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
    {#if multiSelectActive}
      <Button size="small" shape="round" fullWidth onclick={submitMulti} data-testid="add-collections-button">
        {$t('add_to_collections_count', { values: { count: multiSelectedKeys.length } })}
      </Button>
    {/if}
  </ModalBody>
  <ModalFooter>
    <div class="flex w-full justify-around">
      <div class="flex gap-4">
        <div class="flex place-items-center gap-1">
          <span class="rounded-sm bg-gray-300 p-1 dark:bg-gray-500">
            <Icon icon={mdiKeyboardReturn} size="1rem" />
          </span>
          <Text size="tiny">{$t('to_select')}</Text>
        </div>
        <div class="flex place-items-center gap-1">
          <span class="rounded-sm bg-gray-300 p-1 dark:bg-gray-500">
            <Text size="tiny">CTRL</Text>
          </span>
          <Text size="tiny">{$t('to_multi_select')}</Text>
        </div>
      </div>
    </div>
  </ModalFooter>
</Modal>
