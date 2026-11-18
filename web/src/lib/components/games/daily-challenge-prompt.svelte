<script lang="ts">
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    /** True while the enable/decline write and the page reload it triggers are in flight. */
    pending: boolean;
    onEnable: () => void;
    onDecline: () => void;
  }

  let { pending, onEnable, onDecline }: Props = $props();
</script>

<section
  class="flex flex-col gap-3 rounded-3xl border border-gray-300 p-6 dark:border-gray-700"
  data-testid="daily-prompt"
>
  <h2 class="text-lg font-semibold">{$t('game_daily_enable_title')}</h2>
  <p class="max-w-lg text-sm text-gray-600 dark:text-gray-300">{$t('game_daily_enable_description')}</p>

  <div class="flex gap-2">
    <!-- Enabling generates the daily on the reload, so both buttons lock for the whole round trip.
         Enable gets `loading` rather than `disabled` (it implies disabled) because that generation
         takes seconds: a greyed-out button with no spinner reads as a frozen page, which is exactly
         how this was first reported. Decline is a plain column write and needs no spinner. -->
    <Button size="small" loading={pending} onclick={onEnable} data-testid="daily-prompt-enable">
      {$t('game_daily_enable')}
    </Button>
    <Button size="small" variant="outline" disabled={pending} onclick={onDecline} data-testid="daily-prompt-decline">
      {$t('game_daily_decline')}
    </Button>
  </div>
</section>
