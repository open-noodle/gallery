# Pi Expanded Activity Debug Manual QA

## Purpose

Verify that `Activity preview: Expanded` behaves as a stable debug/audit mode while Pi runs many tool calls.

## Setup

- Run Gallery with the Pi runner enabled.
- Open a session that can make several MCP/tool calls.
- Open the browser network tab and filter for `tool-calls`.

## Checklist

1. Set `Activity preview` to `Expanded`.
2. Send a prompt that causes many tool calls, such as finding photos across people, dates, locations, and album changes.
3. Watch repeated `200` responses from `/tool-calls`.
4. Confirm activity rows do not flicker back to only `Understanding request` or `Preparing a plan`.
5. Confirm repeated tool calls remain visible as individual rows or are inspectable through `Show older activity` and `Show newer activity`.
6. Expand `Technical details` on a few rows and confirm tool names, ids, counts, result sizes, and timestamps are present.
7. Confirm API keys, bearer tokens, runner tokens, provider keys, hidden prompts, and reasoning-like text are redacted.
8. Switch to `Compact` and confirm the same turn becomes a low-noise summarized view.
9. Switch to `Off` and confirm passive activity hides while approval requests, plan reviews, applied plans, user messages, and assistant messages remain visible.
10. With browser reduced-motion emulation enabled, confirm the fallback `pi is working...` indicator does not animate.
11. On a narrow/mobile viewport, confirm paging controls and technical detail buttons remain reachable and do not overlap the composer.

## Expected Result

Expanded mode remains stable and inspectable for the full run. Compact mode stays calm. Off mode hides only passive activity. No raw fallback tool cards flash for tool calls already represented by activity rows.
