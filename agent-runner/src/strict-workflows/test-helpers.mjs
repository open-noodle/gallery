export const tripCandidateHandleId = '00000000-0000-4000-8000-000000000921';
export const tripPlanId = '00000000-0000-4000-8000-000000000923';

export const makeTripCandidate = (overrides = {}) => ({
  dedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
  title: 'Recent trip to New York, USA',
  takenAfter: '2026-05-03T00:00:00.000Z',
  takenBefore: '2026-05-12T23:59:59.000Z',
  albumAssetCount: 28,
  excludedDuplicateCount: 3,
  excludedStackChildCount: 1,
  placeLabels: ['New York, USA'],
  selectionHandle: {
    id: tripCandidateHandleId,
    sourceRef: `asset-source:search:${tripCandidateHandleId}`,
    assetCount: 28,
  },
  ...overrides,
});

export const createWorkflowClient = ({
  candidates = [makeTripCandidate()],
  recommendation,
  planResult,
  planError,
} = {}) => {
  const calls = [];
  const resolvedRecommendation =
    recommendation ??
    {
      action: 'use_top_candidate',
      candidateDedupeKey: 'trip:usa:new-york:2026-05-03:2026-05-12',
      reason: 'The only readable trip candidate is high confidence.',
    };

  const client = {
    async call(name, args, options) {
      calls.push({ name, args, options });
      if (name === 'findTripCandidates') {
        return {
          status: 'success',
          recommendation: resolvedRecommendation,
          candidates,
        };
      }

      if (name === 'proposeAlbumFromSelection') {
        if (planError) {
          throw planError;
        }

        return (
          planResult ?? {
            status: 'success',
            plan: { id: tripPlanId },
          }
        );
      }

      throw new Error(`unexpected tool ${name}`);
    },
  };

  return { client, calls };
};
