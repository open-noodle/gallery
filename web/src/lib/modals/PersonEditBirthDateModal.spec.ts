import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import PersonEditBirthDateModal from './PersonEditBirthDateModal.svelte';

describe('PersonEditBirthDateModal', () => {
  it('submits the current date input value without requiring blur first', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    await render(PersonEditBirthDateModal, { props: { birthDate: null, onSave, onClose } });

    const input = document.querySelector('input[name="birthDate"]') as HTMLInputElement;
    input.value = '1990-06-15';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await userEvent.click(page.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith('1990-06-15'));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits an empty birthdate when clearing an existing date', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    await render(PersonEditBirthDateModal, { props: { birthDate: '1990-06-15', onSave, onClose: vi.fn() } });

    await userEvent.click(page.getByRole('button', { name: 'clear' }));
    await userEvent.click(page.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(''));
  });
});
