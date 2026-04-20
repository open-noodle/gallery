<script lang="ts">
  import { Theme, themeManager } from '@immich/ui';

  type Props = {
    variant?: 'icon' | 'inline' | 'stacked';
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    transparent?: boolean;
    class?: string;
  };

  const { variant = 'icon', size = 'medium', transparent = false, class: className }: Props = $props();

  const sizeClasses: Record<string, string> = {
    tiny: 'h-8',
    small: 'h-10',
    medium: 'h-12',
    large: 'h-16',
    giant: 'h-24',
  };

  const variantClasses: Record<string, string> = {
    icon: 'aspect-square',
    inline: '',
    stacked: '',
  };

  const src = $derived.by(() => {
    switch (variant) {
      case 'stacked': {
        return themeManager.value === Theme.Light ? '/gallery-logo-stacked.svg' : '/gallery-logo-stacked-dark.svg';
      }
      case 'inline': {
        return themeManager.value === Theme.Light ? '/gallery-logo-inline-light.svg' : '/gallery-logo-inline-dark.svg';
      }
      default: {
        if (transparent) {
          return themeManager.value === Theme.Light ? '/gallery-loader.svg' : '/gallery-loader-dark.svg';
        }
        return themeManager.value === Theme.Light ? '/gallery-logo-mark.svg' : '/gallery-logo-mark-dark.svg';
      }
    }
  });

  const classes = $derived([sizeClasses[size], variantClasses[variant], className].filter(Boolean).join(' '));
</script>

<img {src} class={classes} alt="Gallery logo" />
