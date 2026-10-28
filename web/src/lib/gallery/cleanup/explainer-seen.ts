const KEY = 'cleanup.rewind.explainer-seen';

/**
 * Whether this browser has seen the rewind explainer. A hint, not account state: a new browser shows it once
 * more. Storage can throw (private mode, blocked site data); then the explainer shows and nothing is saved.
 */
export const explainerSeen = {
  get: (): boolean => {
    try {
      return localStorage.getItem(KEY) === 'true';
    } catch {
      return false;
    }
  },
  set: (): void => {
    try {
      localStorage.setItem(KEY, 'true');
    } catch {
      // Nothing to remember it in; it shows again next time.
    }
  },
};
