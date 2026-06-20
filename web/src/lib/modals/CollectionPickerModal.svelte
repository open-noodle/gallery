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
    type PickerCollection,
  } from '$lib/components/shared-components/collection-selection/collection-selection-utils';
  import NewSpaceListItem from '$lib/components/shared-components/collection-selection/new-space-list-item.svelte';
  import SpaceListItem from '$lib/components/shared-components/collection-selection/space-list-item.svelte';
  import { MAX_SPACE_ASSETS_PER_REQUEST } from '$lib/constants';
  import { authManager } from '$lib/managers/auth-manager.svelte';
  import { eventManager } from '$lib/managers/event-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    createAlbum,
    createSpace,
    getAllAlbums,
    getAllSpaces,
    type AlbumResponseDto,
    type SharedSpaceResponseDto,
  } from '@immich/sdk';
  import { Button, Icon, Modal, ModalBody, ModalFooter, Text } from '@immich/ui';
  import { mdiImageMultipleOutline, mdiInformationOutline, mdiKeyboardReturn } from '@mdi/js';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    assetCount: number;
    onClose: (collections?: PickerCollection[]) => void;
  }

  let { assetCount, onClose }: Props = $props();

  let albums = $state<AlbumResponseDto[]>([]);
  let spaces = $state<SharedSpaceResponseDto[]>([]);
  let loading = $state(true);
  let search = $state('');
  let selectedRowIndex = $state(-1);
  const multiSelectedKeys = $state<string[]>([]);
  const multiSelectActive = $derived(multiSelectedKeys.length > 0);

  const showSpaces = $derived(assetCount <= MAX_SPACE_ASSETS_PER_REQUEST);
  const currentUserId = $derived(authManager.authenticated ? (authManager.user?.id ?? null) : null);

  const albumCollections = $derived(albums.map((a) => albumToCollection(a)));
  const spaceCollections = $derived(
    showSpaces ? spaces.filter((space) => isWritableSpace(space, currentUserId)).map((s) => spaceToCollection(s)) : [],
  );
  const allCollections = $derived([...albumCollections, ...spaceCollections]);

  const recentCollections = $derived(pickRecent(allCollections, 3));

  const converter = new CollectionModalRowConverter();
  const rows = $derived(
    converter.toModalRows(search, recentCollections, allCollections, selectedRowIndex, multiSelectedKeys, {
      showSpaces,
    }),
  );
  const selectableRowCount = $derived(rows.filter((row) => isSelectableRowType(row.type)).length);

  onMount(async () => {
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

  const loadSpaces = async () => {
    spaces = await getAllSpaces();
  };

  const findByKey = (key: string) => allCollections.find((collection) => collectionKey(collection) === key);

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
      case CollectionModalRowType.COLLECTION_ITEM: {
        if (multiSelectActive) {
          submitMulti();
        } else if (item.collection) {
          onClose([item.collection]);
        }
        break;
      }
    }
    selectedRowIndex = -1;
  };

  const onkeydown = async (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp': {
        event.preventDefault();
        selectedRowIndex = selectedRowIndex > 0 ? selectedRowIndex - 1 : selectableRowCount - 1;
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        selectedRowIndex = selectedRowIndex < selectableRowCount - 1 ? selectedRowIndex + 1 : 0;
        break;
      }
      case 'Enter': {
        event.preventDefault();
        await onEnter();
        break;
      }
      case 'Control': {
        event.preventDefault();
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
    <div class="mb-2 flex max-h-[36rem] flex-col">
      {#if loading}
        <!-- eslint-disable-next-line svelte/require-each-key -->
        {#each { length: 3 } as _}
          <div class="flex animate-pulse gap-4 px-6 py-2">
            <div class="h-12 w-12 rounded-xl bg-slate-200"></div>
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
        {#if !showSpaces}
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
              <p class="px-5 py-1 text-sm">{row.text}</p>
            {:else if row.type === CollectionModalRowType.COLLECTION_ITEM && row.collection}
              {@const collection = row.collection}
              <div data-testid={`row-${collection.kind}-${collection.id}`}>
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
                    searchQuery={search}
                    onSpaceClick={() => handleCollectionClick(collection)}
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
    <div class="flex justify-around w-full">
      <div class="flex gap-4">
        <div class="flex gap-1 place-items-center">
          <span class="bg-gray-300 dark:bg-gray-500 rounded p-1">
            <Icon icon={mdiKeyboardReturn} size="1rem" />
          </span>
          <Text size="tiny">{$t('to_select')}</Text>
        </div>
        <div class="flex gap-1 place-items-center">
          <span class="bg-gray-300 dark:bg-gray-500 rounded p-1">
            <Text size="tiny">CTRL</Text>
          </span>
          <Text size="tiny">{$t('to_multi_select')}</Text>
        </div>
      </div>
    </div>
  </ModalFooter>
</Modal>
