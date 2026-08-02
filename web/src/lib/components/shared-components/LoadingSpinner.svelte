<script lang="ts">
  import { Theme, themeManager } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    class?: string;
  }

  const sizeClasses: Record<string, string> = {
    tiny: 'h-3',
    small: 'h-4',
    medium: 'h-5',
    large: 'h-6',
    giant: 'h-12',
  };

  let { size = 'medium', class: className }: Props = $props();

  const src = $derived(themeManager.value === Theme.Light ? '/gallery-loader.svg' : '/gallery-loader-dark.svg');
</script>

<div>
  <img
    role="status"
    class={['animate-spin', sizeClasses[size], className].filter(Boolean).join(' ')}
    {src}
    alt={$t('loading')}
    data-testid="loading-spinner"
  />
</div>
