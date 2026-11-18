<script lang="ts">
  import Thumbhash from '#lib/components/Thumbhash.svelte';
  import LoadingSpinner from '#lib/components/shared-components/LoadingSpinner.svelte';
  import { Icon, Modal, ModalBody } from '@immich/ui';
  import { mdiImageOffOutline } from '@mdi/js';

  // The larger look at a version: its preview-size rendition, served through the photo. The window fills the
  // browser's (the library's sizes stop at 1024 px wide), and the picture takes the room that leaves.

  type Props = {
    title: string;
    src: string;
    thumbhash: string | null;
    onClose: () => void;
  };

  let { title, src, thumbhash, onClose }: Props = $props();

  let loaded = $state(false);
  let failed = $state(false);
</script>

<Modal {title} {onClose} size="full">
  <ModalBody>
    <div class="relative flex h-full min-h-64 items-center justify-center" data-testid="asset-version-preview">
      {#if !loaded && thumbhash}
        <Thumbhash base64ThumbHash={thumbhash} class="absolute inset-0 size-full object-contain opacity-60" />
      {/if}
      {#if failed}
        <span class="relative text-gray-400"><Icon icon={mdiImageOffOutline} size="48" /></span>
      {:else}
        {#if !loaded}
          <span class="absolute"><LoadingSpinner /></span>
        {/if}
        <img
          {src}
          alt={title}
          draggable="false"
          class="relative max-h-[calc(100dvh-9rem)] max-w-full object-contain"
          class:invisible={!loaded}
          onload={() => (loaded = true)}
          onerror={() => (failed = true)}
        />
      {/if}
    </div>
  </ModalBody>
</Modal>
