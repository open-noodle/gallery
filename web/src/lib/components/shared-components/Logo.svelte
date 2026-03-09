<script lang="ts">
  type Props = {
    variant?: 'icon' | 'inline' | 'stacked';
    size?: 'tiny' | 'small' | 'medium' | 'large' | 'giant';
    class?: string;
  };

  const { variant = 'icon', size = 'medium', class: className }: Props = $props();

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

  let isDark = $state(false);

  if (globalThis.window !== undefined) {
    const mql = globalThis.matchMedia('(prefers-color-scheme: dark)');
    isDark = mql.matches;
    mql.addEventListener('change', (e) => {
      isDark = e.matches;
    });
  }

  const src = $derived.by(() => {
    switch (variant) {
      case 'stacked': {
        return '/gallery-logo-stacked.svg';
      }
      case 'inline': {
        return isDark ? '/gallery-logo-inline-dark.svg' : '/gallery-logo-inline-light.svg';
      }
      default: {
        return '/gallery-logo-mark.svg';
      }
    }
  });

  const classes = $derived([sizeClasses[size], variantClasses[variant], className].filter(Boolean).join(' '));
</script>

<img {src} class={classes} alt="Gallery logo" />
