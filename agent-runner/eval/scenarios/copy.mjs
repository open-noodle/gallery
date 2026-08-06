// Copy fidelity (fuzzy): the llm-polish rephrase must preserve the structured
// facts (album name, asset count) and keep the "review before applying" framing,
// and must not claim the change already happened. Scored as a pass-rate over
// repeated runs since polish is model-dependent.
export default [
  {
    id: 'copy.trip.usa.with-exclusions',
    category: 'copy',
    summary: {
      workflowKind: 'create_recent_trip_album',
      albumName: 'USA Trip',
      label: 'New York, USA',
      dateRange: 'May 3-12, 2026',
      assetCount: 28,
      exclusions: '3 known duplicate variants and 1 stack child',
    },
    expect: { contains: ['USA Trip', '28', 'review'], notContains: ['created the album', 'done!'] },
  },
  {
    id: 'copy.trip.italy.no-exclusions',
    category: 'copy',
    summary: {
      workflowKind: 'create_recent_trip_album',
      albumName: 'Italy Trip',
      label: 'Florence, Italy',
      dateRange: 'June 1-5, 2026',
      assetCount: 14,
    },
    expect: { contains: ['Italy Trip', '14', 'review'] },
  },
  {
    id: 'copy.trip.long-name',
    category: 'copy',
    summary: {
      workflowKind: 'create_recent_trip_album',
      albumName: 'Spring Break',
      label: 'Cancún, Mexico',
      dateRange: 'March 14-21, 2026',
      assetCount: 92,
    },
    expect: { contains: ['Spring Break', '92', 'review'] },
  },
];
