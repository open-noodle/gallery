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

const TAP_HINT_KEY = 'cleanup.rewind.tap-hint-done';

/** Whether this browser has finished a rewind day, after which the touch "how to mark" hint stops showing. */
export const tapHintDone = {
  get: (): boolean => {
    try {
      return localStorage.getItem(TAP_HINT_KEY) === 'true';
    } catch {
      return false;
    }
  },
  set: (): void => {
    try {
      localStorage.setItem(TAP_HINT_KEY, 'true');
    } catch {
      // Nothing to remember it in; the hint shows again next time.
    }
  },
};
