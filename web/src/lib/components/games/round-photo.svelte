<script lang="ts">
  import { roundImageUrl } from '$lib/utils/game';

  type Props = {
    challengeId: string;
    index: number;
    alt: string;
    dimmed?: boolean; // the result view dims the photo behind the reveal
  };

  let { challengeId, index, alt, dimmed = false }: Props = $props();

  // Keyed by challenge + round index only (spec §6) — never by asset id, so the
  // client never learns which asset a round shows until the player has guessed.
  let src = $derived(roundImageUrl(challengeId, index));
</script>

<img {src} {alt} data-testid="round-photo" class={['size-full object-cover', dimmed && 'brightness-50']} />
