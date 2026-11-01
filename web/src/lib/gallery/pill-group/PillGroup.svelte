<script lang="ts" generics="T extends string">
  import type { HTMLAttributes } from 'svelte/elements';
  import { twMerge } from 'tailwind-merge';

  type Option = { value: T; label: string; title?: string; testId?: string };

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class'> & {
    class?: string;
    options: Option[];
    value: T;
    label: string;
    disabled?: boolean;
    onChange: (value: T) => void;
  };

  let { options, value, label, disabled = false, class: className = '', onChange, ...rest }: Props = $props();

  const select = (next: T) => {
    if (!disabled && next !== value) {
      onChange(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (disabled || (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft')) {
      return;
    }

    event.preventDefault();

    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const index = options.findIndex((option) => option.value === value);
    select(options[(index + direction + options.length) % options.length].value);
  };
</script>

<div
  class={twMerge(
    'inline-flex items-center gap-1 rounded-full bg-white/95 p-1 ring-1 ring-black/10 dark:bg-immich-dark-gray dark:ring-white/10',
    className,
  )}
  role="group"
  aria-label={label}
  {...rest}
>
  {#each options as option (option.value)}
    <button
      class="rounded-full px-3 py-1 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60 aria-pressed:bg-immich-primary aria-pressed:text-white dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
      type="button"
      data-testid={option.testId}
      title={option.title}
      aria-pressed={option.value === value}
      {disabled}
      onclick={() => select(option.value)}
      onkeydown={onKeyDown}
    >
      {option.label}
    </button>
  {/each}
</div>
