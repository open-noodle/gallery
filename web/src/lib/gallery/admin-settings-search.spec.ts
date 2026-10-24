import type { Translations } from 'svelte-i18n';
import { adminSettingsSearch, extractTranslationKeys } from '$lib/gallery/admin-settings-search.svelte';

const server = { key: 'server', title: 'Server Settings', subtitle: 'Manage server settings' };
const english: Record<string, string> = {
  'admin.server_merge_people_across_owners': 'Allow merging people across owners',
  'admin.server_space_editors_can_add_members': 'Let space editors add members',
};
const translate = (key: Translations) => english[key as string] ?? (key as string);

describe('extractTranslationKeys', () => {
  it('lists each $t key a component uses once', () => {
    const source = `<p>{$t('admin.a')}</p><Switch title={$t( 'admin.b' )} /><p>{$t('admin.a', { values: { n: 1 } })}</p>`;
    expect(extractTranslationKeys(source)).toEqual(['admin.a', 'admin.b']);
  });
});

describe('adminSettingsSearch (#1112)', () => {
  it('matches every section for an empty query', () => {
    expect(adminSettingsSearch.matches(server, '  ', translate)).toBe(true);
  });

  it('matches a section by its title or description, case-insensitively', () => {
    expect(adminSettingsSearch.matches(server, 'SERVER', translate)).toBe(true);
  });

  it('matches a section by a setting inside it once the section sources load', async () => {
    adminSettingsSearch.matches(server, 'merging', translate);
    await vi.waitFor(() => expect(adminSettingsSearch.matches(server, 'merging', translate)).toBe(true));
  });

  it('matches the server section by a setting rendered in a fork component', async () => {
    adminSettingsSearch.matches(server, 'space editors', translate);
    await vi.waitFor(() => expect(adminSettingsSearch.matches(server, 'space editors', translate)).toBe(true));
  });

  it('does not match an unrelated query', async () => {
    adminSettingsSearch.matches(server, 'merging', translate);
    await vi.waitFor(() => expect(adminSettingsSearch.matches(server, 'merging', translate)).toBe(true));
    expect(adminSettingsSearch.matches(server, 'zzzz', translate)).toBe(false);
  });
});
