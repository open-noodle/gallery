import { FamilyUnionStatus } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import FamilyUnionEditor from '$lib/components/family/FamilyUnionEditor.svelte';

function renderEditor(props: {
  status?: FamilyUnionStatus;
  startDate?: string | null;
  endDate?: string | null;
  onSave?: (payload: { status: FamilyUnionStatus; startDate: string | null; endDate: string | null }) => void;
  onCancel?: () => void;
}) {
  const onSave = props.onSave ?? vi.fn();
  const onCancel = props.onCancel ?? vi.fn();
  const result = render(FamilyUnionEditor, {
    status: props.status ?? FamilyUnionStatus.Partnered,
    startDate: props.startDate ?? null,
    endDate: props.endDate ?? null,
    onSave,
    onCancel,
  });
  return { ...result, onSave, onCancel };
}

function pickStatus(status: FamilyUnionStatus) {
  const option = screen
    .getAllByTestId('family-union-status-option')
    .find((element) => element.dataset.value === status);
  if (!option) {
    throw new Error(`No status option for ${status}`);
  }
  return userEvent.click(option);
}

describe('FamilyUnionEditor', () => {
  it('records a marriage with its status and dates', async () => {
    const { onSave } = renderEditor({ status: FamilyUnionStatus.Partnered, startDate: null, endDate: null });

    await pickStatus(FamilyUnionStatus.Married);
    await fireEvent.input(screen.getByTestId('family-union-start-date'), { target: { value: '1985-06-01' } });
    await userEvent.click(screen.getByTestId('family-union-editor-save'));

    expect(onSave).toHaveBeenCalledWith({
      status: FamilyUnionStatus.Married,
      startDate: '1985-06-01',
      endDate: null,
    });
  });

  it('accepts a divorced union with no end date', async () => {
    const { onSave } = renderEditor({ status: FamilyUnionStatus.Married, startDate: '1988-01-01', endDate: null });

    await pickStatus(FamilyUnionStatus.Divorced);
    await userEvent.click(screen.getByTestId('family-union-editor-save'));

    expect(onSave).toHaveBeenCalledWith({
      status: FamilyUnionStatus.Divorced,
      startDate: '1988-01-01',
      endDate: null,
    });
    expect(screen.queryByTestId('family-union-editor-error')).not.toBeInTheDocument();
  });

  it('refuses an end date earlier than the start date', async () => {
    const { onSave } = renderEditor({ status: FamilyUnionStatus.Married, startDate: null, endDate: null });

    await fireEvent.input(screen.getByTestId('family-union-start-date'), { target: { value: '2007-01-01' } });
    await fireEvent.input(screen.getByTestId('family-union-end-date'), { target: { value: '1988-01-01' } });
    await userEvent.click(screen.getByTestId('family-union-editor-save'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByTestId('family-union-editor-error')).toBeInTheDocument();
  });

  it('calls onCancel without saving when cancel is clicked', async () => {
    const { onSave, onCancel } = renderEditor({});

    await userEvent.click(screen.getByTestId('family-union-editor-cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });
});
