<script lang="ts">
  import { getPeopleThumbnailUrl } from '$lib/utils';
  import { type PersonResponseDto } from '@immich/sdk';
  import ImageThumbnail from '$lib/components/assets/thumbnail/ImageThumbnail.svelte';

  interface Props {
    person: PersonResponseDto;
    selectable?: boolean;
    selected?: boolean;
    thumbnailSize?: number | null;
    circle?: boolean;
    border?: boolean;
    onClick?: (person: PersonResponseDto) => void;
  }

  let {
    person,
    selectable = false,
    selected = false,
    thumbnailSize = null,
    circle = false,
    border = false,
    onClick = () => {},
  }: Props = $props();
</script>

<!-- Without an explicit `thumbnailSize` the tile fills its grid cell. It has to size itself off its
     own width (`aspect-square`) rather than `height: 100%`: the grid rows are auto-sized from their
     content, so a percentage height has nothing to resolve against and the square thumbnail inside
     spills out the bottom of the tile (#1082). -->
<button
  type="button"
  class={['relative rounded-lg transition-all', !thumbnailSize && 'aspect-square w-full']}
  onclick={() => onClick(person)}
  disabled={!selectable}
  style:width={thumbnailSize ? thumbnailSize + 'px' : undefined}
  style:height={thumbnailSize ? thumbnailSize + 'px' : undefined}
>
  <div
    class="size-full border-2 brightness-90 filter"
    class:rounded-full={circle}
    class:rounded-lg={!circle}
    class:border-transparent={!border}
    class:dark:border-immich-dark-primary={border}
    class:border-immich-primary={border}
  >
    <!-- Trigger a re-render on person change as <Image> captures only the first src -->
    {#key person.id}
      <ImageThumbnail {circle} url={getPeopleThumbnailUrl(person)} altText={person.name} widthStyle="100%" shadow />
    {/key}
  </div>

  <div
    class="absolute inset-s-0 top-0 size-full bg-immich-primary/30 opacity-0"
    class:hover:opacity-100={selectable}
    class:rounded-full={circle}
    class:rounded-lg={!circle}
  ></div>

  {#if selected}
    <div
      class="absolute inset-s-0 top-0 size-full bg-blue-500/80"
      class:rounded-full={circle}
      class:rounded-lg={!circle}
    ></div>
  {/if}

  {#if person.name}
    <span
      class="text-white-shadow absolute inset-s-0 bottom-1 w-full truncate px-1 text-center text-xs font-medium text-white hover:cursor-pointer md:bottom-2 md:text-sm"
    >
      {person.name}
    </span>
  {/if}
</button>
