<script lang="ts">
  import { getMapProviderLinks } from '$lib/utils/exif-utils';
  import { Link } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = { lat: number; lon: number };

  const { lat, lon }: Props = $props();
</script>

<div class="flex flex-col items-center gap-1">
  {#each getMapProviderLinks(lat, lon) as link (link.key)}
    <Link href={link.url} class="text-primary">
      {$t(link.label)}
    </Link>
  {/each}
</div>
