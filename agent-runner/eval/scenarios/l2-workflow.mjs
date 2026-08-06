// L2 scenarios — workflow EXECUTION against the seeded fake MCP client.
//
// These assert what L1 cannot: the exact tool sequence a workflow issues, the
// shape of the plan it proposes, and which outcome arm it lands in. Every
// scenario is deterministic (fixed clock, frozen dataset, regex routing), so
// `runs` is 1 and the threshold is 1 — any failure is a real regression, never
// model variance.
const strict = { runs: 1, threshold: 1 };

export default [
  {
    id: 'l2.rename.planned',
    category: 'execution',
    prompt: 'rename my Japan album to Japan 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums', 'proposeAlbumOperations'],
      planOps: ['album.updateDetails'],
      outcomeStatus: 'planned',
    },
    ...strict,
  },
  {
    id: 'l2.rename.ambiguous.needs-input',
    category: 'execution',
    prompt: 'rename my Summer album to Summer 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums'],
      outcomeStatus: 'needs_input',
      noPlan: true,
    },
    ...strict,
  },
  {
    id: 'l2.rename.missing.needs-input',
    category: 'execution',
    prompt: 'rename my Atlantis album to Atlantis 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums'],
      outcomeStatus: 'needs_input',
      noPlan: true,
    },
    ...strict,
  },
  {
    id: 'l2.trip.planned',
    category: 'execution',
    prompt: 'create an album for my recent trip to Japan',
    expect: {
      kind: 'create_recent_trip_album',
      outcomeStatus: 'planned',
      // Selection-based plan tool: no operations array, so planOps is not asserted.
    },
    ...strict,
  },
  {
    id: 'l2.negatives.question',
    category: 'negatives',
    prompt: 'what is the weather like today?',
    expect: { kind: 'none', toolSequence: [], noPlan: true },
    ...strict,
  },
  {
    id: 'l2.negatives.chatter',
    category: 'negatives',
    prompt: 'thanks!',
    expect: { kind: 'none', toolSequence: [], noPlan: true },
    ...strict,
  },
];
