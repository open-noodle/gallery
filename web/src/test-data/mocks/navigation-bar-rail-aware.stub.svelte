<script lang="ts">
  // Records the `railAware` prop UserPageLayout passes through so tests can assert it, rather
  // than treating NavigationBar as an opaque noop - the whole point of the tests using this
  // stub is to catch UserPageLayout passing (or failing to pass) the flag correctly.
  interface Props {
    railAware?: boolean;
  }

  let { railAware }: Props = $props();
</script>

<div data-testid="navigation-bar-stub" data-rail-aware={String(railAware)}></div>
