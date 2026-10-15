import FamilyUnionEditor from '#lib/components/family/FamilyUnionEditor.svelte';
import { FamilyUnionStatus } from '@immich/sdk';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

async function renderEditor(props: {
  status?: FamilyUnionStatus;
  startDate?: string | null;
  endDate?: string | null;
  onSave?: (payload: { status: FamilyUnionStatus; startDate: string | null; endDate: string | null }) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const onSave = props.onSave ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const onDelete = props.onDelete ?? vi.fn();
  const result = await render(FamilyUnionEditor, {
    status: props.status ?? FamilyUnionStatus.Partnered,
    startDate: props.startDate ?? null,
    endDate: props.endDate ?? null,
    onSave,
    onCancel,
    onDelete,
  });
  return { ...result, onSave, onCancel, onDelete };
}

function pickStatus(status: FamilyUnionStatus) {
  const option = (page.getByTestId('family-union-status-option').elements() as HTMLElement[]).find(
    (element) => element.dataset.value === status,
  );
  if (!option) {
    throw new Error(`No status option for ${status}`);
  }
  return userEvent.click(option);
}

describe('FamilyUnionEditor', () => {
  it('records a marriage with its status and dates', async () => {
    const { onSave } = await renderEditor({ status: FamilyUnionStatus.Partnered, startDate: null, endDate: null });

    await pickStatus(FamilyUnionStatus.Married);
    await userEvent.fill(page.getByTestId('family-union-start-date').element(), '1985-06-01');
    await userEvent.click(page.getByTestId('family-union-editor-save').element());

    expect(onSave).toHaveBeenCalledWith({
      status: FamilyUnionStatus.Married,
      startDate: '1985-06-01',
      endDate: null,
    });
  });

  it('accepts a divorced union with no end date', async () => {
    const { onSave } = await renderEditor({
      status: FamilyUnionStatus.Married,
      startDate: '1988-01-01',
      endDate: null,
    });

    await pickStatus(FamilyUnionStatus.Divorced);
    await userEvent.click(page.getByTestId('family-union-editor-save').element());

    expect(onSave).toHaveBeenCalledWith({
      status: FamilyUnionStatus.Divorced,
      startDate: '1988-01-01',
      endDate: null,
    });
    expect(page.getByTestId('family-union-editor-error').query()).not.toBeInTheDocument();
  });

  it('refuses an end date earlier than the start date', async () => {
    const { onSave } = await renderEditor({ status: FamilyUnionStatus.Married, startDate: null, endDate: null });

    await userEvent.fill(page.getByTestId('family-union-start-date').element(), '2007-01-01');
    await userEvent.fill(page.getByTestId('family-union-end-date').element(), '1988-01-01');
    await userEvent.click(page.getByTestId('family-union-editor-save').element());

    expect(onSave).not.toHaveBeenCalled();
    expect(page.getByTestId('family-union-editor-error').element()).toBeInTheDocument();
  });

  it('calls onCancel without saving when cancel is clicked', async () => {
    const { onSave, onCancel } = await renderEditor({});

    await userEvent.click(page.getByTestId('family-union-editor-cancel').element());

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
