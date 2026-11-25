<script lang="ts">
  import { Route } from '#lib/route.ts';
  import { Button, Heading, Icon, Text } from '@immich/ui';
  import { mdiAccountOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
</script>

<main class="flex min-h-dvh w-full flex-col items-center justify-center gap-4 p-6 text-center">
  <Icon icon={mdiAccountOffOutline} size="48" class="text-gray-500 dark:text-gray-400" />
  <Heading size="medium" tag="h1">{$t('person_unavailable_title')}</Heading>
  <Text color="muted">{$t('person_unavailable_description')}</Text>
  <Button href={Route.people()}>{$t('people')}</Button>
</main>
