# Save external network addresses independently of live checks

Issue: https://github.com/open-noodle/gallery/issues/1220

External network addresses describe networks the phone may not currently be on.
Previously the settings widget persisted only entries whose live authenticated
connection check succeeded. An unreachable address disappeared from the saved
list, including when reordering or deleting a different entry.

The external endpoint list now saves nonempty HTTP(S) URLs with a host regardless
of their reachability status. Invalid syntax and unsupported schemes remain
excluded. Whitespace is trimmed; the path, port and order are preserved. No new
setting or storage key is introduced.

The Gallery input subclasses the upstream input so rendering, controls and status
icons stay upstream behavior. On blur it persists the syntactically valid address
before awaiting the live check. The check still runs with the same authentication
and connection rules, and its success or failure updates the existing icon. A late
result cannot update a disposed row or overwrite a newer edit of the text.
Saving refreshes request headers for the updated endpoint list even when a check
has not succeeded yet, so a saved fallback is configured for a later connection.

This changes configuration persistence, not login or server authorization. Saving
an address grants no access and bypasses no TLS or authentication checks. Existing
network switching still decides which reachable endpoint to use. No new visible
strings are added, so the existing translations continue to apply.

New logic and widget overrides live under `mobile/lib/gallery/networking/`, with
tests under `mobile/test/gallery/networking/`. The upstream external-list widget
keeps a save-hook call and the input registration; the upstream input itself is
unchanged. The PR records its measured diff against the pinned Immich tag.
Measured against `refs/upstream/v3.4.2`, the external-list file changes from an
empty diff to +4/-19: the save implementation shrinks into one fork call, and
the input registration selects the Gallery subclass. No other upstream file
is modified.

Old app/new server behavior is unchanged. New app/old Gallery server and new
app/stock Immich use the same existing connection checks and stored URL format.
No API or database migration is required.

Regression coverage uses the actual external-network widget and an in-memory
settings database. It checks persistence for valid, failed, loading and unknown
status, invalid syntax, preservation of sibling entries, saving during a pending
check and disposal before completion. Pure policy tests cover HTTP(S) URLs,
ports, paths, IPv6 and list order independently of reachability.
They also verify that stale checks cannot replace a newer address or status and
that an unexpected check error preserves the saved address. The failed-status
persistence regression was run against the original widget and failed with an
empty saved list before the fix was registered.
