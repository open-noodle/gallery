/**
 * The nine locales the fork maintains by hand. Every fork-added or fork-edited string must exist — and stay
 * correct — in all of them; the remaining ~80 locale files belong to translators and must never be
 * hand-edited (see placeholders.spec.ts, which is scoped to this list for exactly that reason).
 *
 * Single source of truth: fork-string-parity.spec.ts and face-cleanup-i18n-coverage.spec.ts previously each
 * declared their own copy of this list, which could silently drift out of sync with each other.
 */
export const FORK_LOCALES: readonly string[] = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'ru', 'zh_Hans', 'zh_Hant'];
