<script lang="ts">
  import { handleUpdatePersonBirthDate } from '$lib/services/person.service';
  import { type PersonResponseDto } from '@immich/sdk';
  import { Button, DatePicker, Field, FormModal, HelperText } from '@immich/ui';
  import { mdiCake } from '@mdi/js';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  type Props = {
    person?: PersonResponseDto;
    birthDate?: string | null;
    onSave?: (birthDate: string) => Promise<boolean | void>;
    onClose: () => void;
  };

  let { person, birthDate: initialBirthDate = null, onSave, onClose }: Props = $props();
  const initialBirthDateValue = person?.birthDate ?? initialBirthDate ?? '';
  let birthDate = $state<DateTime | undefined>(
    initialBirthDateValue ? DateTime.fromISO(initialBirthDateValue) : undefined,
  );
  const hasBirthDate = Boolean(initialBirthDateValue);

  const onSubmit = async (event: SubmitEvent) => {
    const formBirthDate =
      event.currentTarget instanceof HTMLFormElement ? new FormData(event.currentTarget).get('birthDate') : undefined;
    const submittedBirthDate = typeof formBirthDate === 'string' ? formBirthDate : (birthDate?.toISODate() ?? '');

    const success = onSave
      ? await onSave(submittedBirthDate)
      : person && (await handleUpdatePersonBirthDate(person, submittedBirthDate));
    if (success) {
      onClose();
    }
  };
</script>

<FormModal title={$t('set_date_of_birth')} size="small" icon={mdiCake} {onClose} {onSubmit}>
  <div class="my-2 flex flex-col gap-2">
    <Field label={$t('date_of_birth')}>
      <input type="hidden" name="birthDate" value={birthDate?.toISODate() ?? ''} />
      <DatePicker bind:value={birthDate} maxDate={DateTime.now()} />
      <HelperText>{$t('birthdate_set_description')}</HelperText>
    </Field>
    {#if hasBirthDate}
      <div class="flex justify-end">
        <Button shape="round" color="secondary" size="small" onclick={() => (birthDate = undefined)}>
          {$t('clear')}
        </Button>
      </div>
    {/if}
  </div>
</FormModal>
