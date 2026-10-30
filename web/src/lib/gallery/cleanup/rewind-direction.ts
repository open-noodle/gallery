let pending: -1 | 1 | undefined;

/**
 * Which way the user stepped between dates in rewind (1: the next date, -1: the previous one), handed to the
 * next date's page once so its photos slide in from that side. 0 when the page was reached any other way.
 */
export const rewindDirection = {
  set: (direction: -1 | 1) => {
    pending = direction;
  },
  take: (): -1 | 0 | 1 => {
    const direction = pending ?? 0;
    pending = undefined;
    return direction;
  },
};
