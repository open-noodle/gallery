<script lang="ts">
  import PurchaseContent from '$lib/components/shared-components/purchasing/purchase-content.svelte';
  import { Modal, ModalBody } from '@immich/ui';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();
</script>

<Modal title=" " {onClose} size="large">
  <ModalBody>
    <PurchaseContent showMessage={false} />
  </ModalBody>
</Modal>
