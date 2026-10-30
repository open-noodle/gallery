<script lang="ts">
  import type { SharedSpaceResponseDto, SharedSpaceUpdateDto } from '@immich/sdk';
  import { Field, Select, Text, type SelectOption } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    space: SharedSpaceResponseDto;
    onChange: (dto: SharedSpaceUpdateDto) => Promise<void>;
  }

  type Choice = 'default' | 'on' | 'off';

  const { space, onChange }: Props = $props();
  const management = $derived(space.memberManagement);

  const toChoice = (value: boolean | null | undefined): Choice => {
    if (value === null || value === undefined) {
      return 'default';
    }
    return value ? 'on' : 'off';
  };
  const toValue = (choice: Choice): boolean | null => (choice === 'default' ? null : choice === 'on');

  const optionsFor = (serverDefault: boolean): SelectOption<Choice>[] => [
    {
      label: $t(
        serverDefault ? 'spaces_member_permission_server_default_on' : 'spaces_member_permission_server_default_off',
      ),
      value: 'default',
    },
    { label: $t('spaces_member_permission_on'), value: 'on' },
    { label: $t('spaces_member_permission_off'), value: 'off' },
  ];
</script>

{#if management}
  <div
    class="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800"
    data-testid="member-permission-settings"
  >
    <div class="flex items-center justify-between gap-3">
      <Text size="small" fontWeight="medium">{$t('spaces_editors_can_add_members')}</Text>
      <Field class="w-48 shrink-0">
        <Select
          value={toChoice(management.editorsCanAddMembers)}
          options={optionsFor(management.serverEditorsCanAddMembers)}
          onChange={(choice) => void onChange({ editorsCanAddMembers: toValue(choice) })}
        />
      </Field>
    </div>
    <div class="flex items-center justify-between gap-3">
      <Text size="small" fontWeight="medium">{$t('spaces_editors_can_change_roles')}</Text>
      <Field class="w-48 shrink-0">
        <Select
          value={toChoice(management.editorsCanChangeRoles)}
          options={optionsFor(management.serverEditorsCanChangeRoles)}
          onChange={(choice) => void onChange({ editorsCanChangeRoles: toValue(choice) })}
        />
      </Field>
    </div>
  </div>
{/if}
