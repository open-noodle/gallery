import type { Translations } from 'svelte-i18n';
import { SvelteMap } from 'svelte/reactivity';

type Translate = (key: Translations) => string;

export type SettingsSection = { key: string; title: string; subtitle: string };

/**
 * Source file of each system-settings section, by the section `key` the settings page uses. A section is
 * searchable by the translated text of every `$t('…')` key its component renders, so a query like "merge",
 * "delete" or "cache" finds the setting inside a section whose title does not mention it (#1112).
 */
const SECTION_SOURCES: Record<string, string> = {
  authentication: '/src/routes/admin/system-settings/AuthSettings.svelte',
  backup: '/src/routes/admin/system-settings/BackupSettings.svelte',
  image: '/src/routes/admin/system-settings/ImageSettings.svelte',
  'integrity-checks': '/src/routes/admin/system-settings/IntegrityChecksSettings.svelte',
  job: '/src/routes/admin/system-settings/JobSettings.svelte',
  'external-library': '/src/routes/admin/system-settings/LibrarySettings.svelte',
  logging: '/src/routes/admin/system-settings/LoggingSettings.svelte',
  'machine-learning': '/src/routes/admin/system-settings/MachineLearningSettings.svelte',
  classification: '/src/routes/admin/system-settings/ClassificationSettings.svelte',
  location: '/src/routes/admin/system-settings/MapSettings.svelte',
  metadata: '/src/routes/admin/system-settings/MetadataSettings.svelte',
  'nightly-tasks': '/src/routes/admin/system-settings/NightlyTasksSettings.svelte',
  memories: '/src/routes/admin/system-settings/MemoriesSettings.svelte',
  notifications: '/src/routes/admin/system-settings/NotificationSettings.svelte',
  server: '/src/routes/admin/system-settings/ServerSettings.svelte',
  'storage-template': '/src/lib/components/admin-settings/StorageTemplateSettings.svelte',
  'storage-usage': '/src/routes/admin/system-settings/StorageUsageSettings.svelte',
  theme: '/src/routes/admin/system-settings/ThemeSettings.svelte',
  trash: '/src/routes/admin/system-settings/TrashSettings.svelte',
  'user-settings': '/src/routes/admin/system-settings/UserSettings.svelte',
  'version-check': '/src/routes/admin/system-settings/NewVersionCheckSettings.svelte',
  'video-transcoding': '/src/routes/admin/system-settings/FFmpegSettings.svelte',
};

// Raw sources, fetched only when someone first searches the settings page.
const sourceLoaders = import.meta.glob<string>(
  ['/src/routes/admin/system-settings/*.svelte', '/src/lib/components/admin-settings/StorageTemplateSettings.svelte'],
  { query: '?raw', import: 'default' },
);

const TRANSLATION_KEY = /\$t\(\s*'([^']+)'/g;

export const extractTranslationKeys = (source: string) => {
  const keys = [...source.matchAll(TRANSLATION_KEY)].map((match) => match[1]);
  return keys.filter((key, index) => keys.indexOf(key) === index);
};

const translateSafely = (translate: Translate, key: string) => {
  try {
    // Messages with ICU placeholders render without their values; strip any markup.
    return translate(key as Translations).replaceAll(/<[^>]*>/g, ' ');
  } catch {
    return '';
  }
};

class AdminSettingsSearch {
  #keysBySection = new SvelteMap<string, string[]>();
  #loadStarted = false;

  /** Loads the section sources once; the matches re-run when they arrive. */
  #ensureLoaded() {
    if (this.#loadStarted) {
      return;
    }
    this.#loadStarted = true;
    for (const [sectionKey, path] of Object.entries(SECTION_SOURCES)) {
      const load = sourceLoaders[path];
      if (!load) {
        continue;
      }
      void load()
        .then((source) => this.#keysBySection.set(sectionKey, extractTranslationKeys(source)))
        // A section that fails to load stays searchable by its title and description.
        .catch(() => {});
    }
  }

  /** Whether a settings section matches the search: its title, its description, or any setting it contains. */
  matches(section: SettingsSection, query: string, translate: Translate) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return true;
    }
    if (section.title.toLowerCase().includes(needle) || section.subtitle.toLowerCase().includes(needle)) {
      return true;
    }
    this.#ensureLoaded();
    const keys = this.#keysBySection.get(section.key) ?? [];
    return keys.some((key) => translateSafely(translate, key).toLowerCase().includes(needle));
  }
}

export const adminSettingsSearch = new AdminSettingsSearch();
