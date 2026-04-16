let original: typeof AbortSignal.timeout | undefined;

export function installFakeAbortTimeout() {
  original = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  };
}

export function restoreAbortTimeout() {
  if (original) {
    AbortSignal.timeout = original;
  }
}
