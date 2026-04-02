<script lang="ts">
  import Logo from '$lib/components/shared-components/Logo.svelte';
  import { Button, Heading, Icon } from '@immich/ui';
  import { mdiForumOutline, mdiStarOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    showTitle?: boolean;
    showMessage?: boolean;
  }

  let { showTitle = true, showMessage = true }: Props = $props();

  const discordLink = 'https://discord.gg/cxBfbuxyG4';
  const githubLink = 'https://github.com/open-noodle/gallery';
</script>

<section>
  {#if showTitle}
    <div class="flex place-items-center gap-3">
      <Logo variant="icon" size="small" />
      <Heading color="primary" tag="h1" class="text-4xl font-bold tracking-wider">
        {$t('purchase_option_title')}
      </Heading>
    </div>
  {/if}

  {#if showMessage}
    <div class="mt-4">
      <p>
        {$t('purchase_panel_info_1')}
      </p>
      <br />
      <p>
        {$t('purchase_panel_info_2')}
      </p>
    </div>
  {/if}

  <div class="mt-6 flex flex-col gap-6 sm:flex-row">
    <div
      class="flex flex-1 flex-col place-items-center rounded-3xl border border-gray-300 bg-gray-100 p-8 text-center dark:border-gray-800 dark:bg-gray-900"
    >
      <Icon icon={mdiForumOutline} size="56" class="text-primary" />
      <p class="mt-4 text-lg font-semibold text-primary">{$t('purchase_discord_title')}</p>
      <p class="mt-2 dark:text-immich-gray">{$t('purchase_discord_description')}</p>
      <div class="mt-6 w-full max-w-xs">
        <Button shape="round" href={discordLink} fullWidth>{$t('purchase_discord_button')}</Button>
      </div>
    </div>

    <div
      class="flex flex-1 flex-col place-items-center rounded-3xl border border-gray-300 bg-gray-100 p-8 text-center dark:border-gray-800 dark:bg-gray-900"
    >
      <Icon icon={mdiStarOutline} size="56" class="text-primary" />
      <p class="mt-4 text-lg font-semibold text-primary">{$t('purchase_github_title')}</p>
      <p class="mt-2 dark:text-immich-gray">{$t('purchase_github_description')}</p>
      <div class="mt-6 w-full max-w-xs">
        <Button shape="round" href={githubLink} fullWidth>{$t('purchase_github_button')}</Button>
      </div>
    </div>
  </div>
</section>
