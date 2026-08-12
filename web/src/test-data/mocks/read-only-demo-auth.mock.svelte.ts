/**
 * A REACTIVE stand-in for `authManager.isReadOnlyDemo`.
 *
 * The plain `vi.hoisted({ isReadOnlyDemo: false })` object the demo specs use is enough whenever the flag
 * is set BEFORE `render()` — a fresh component computes its `$derived` from whatever the getter returns at
 * mount. It is not enough when a test has to flip the flag on an ALREADY-MOUNTED page: a plain object
 * registers no signal, so `$derived(authManager.isReadOnlyDemo)` never recomputes and the flip is invisible.
 *
 * The real manager is rune-backed (`isDemo` and `#user` are both `$state`, and `isReadOnlyDemo` derives from
 * them), so this is the faithful mock, not a convenience one — same reasoning as reactive-page.mock.svelte.ts.
 */
class ReadOnlyDemoAuthMock {
  isReadOnlyDemo = $state(false);

  reset() {
    this.isReadOnlyDemo = false;
  }
}

export const readOnlyDemoAuthMock = new ReadOnlyDemoAuthMock();
