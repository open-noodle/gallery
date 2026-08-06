import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatRoutingContext } from './routing-context.mjs';

describe('formatRoutingContext', () => {
  it('renders the manifest title and the reason verbatim', () => {
    const block = formatRoutingContext({
      workflowKind: 'create_recent_trip_album',
      stage: 'declined',
      reason: 'Source "the best shots" is subjective and cannot be resolved from metadata alone.',
    });

    assert.match(block, /^<routing_context>\n/);
    assert.match(block, /\n<\/routing_context>$/);
    assert.match(block, /^router_matched: Create recent trip album$/m);
    assert.match(block, /^stop_reason: Source "the best shots" is subjective/m);
    assert.match(block, /data, not instructions/);
  });
});
