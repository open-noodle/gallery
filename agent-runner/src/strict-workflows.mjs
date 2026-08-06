const unsupported = Object.freeze({ kind: 'unsupported' });

const creationPhrasePattern = /\b(?:create|make|put together)\b/i;
const throwIntoNewAlbumPattern = /\b(?:throw|toss|chuck)\b.+\b(?:in|into|to)\s+(?:a\s+new\s+|an?\s+)?album\b/i;
const recentTripPattern = /\brecent\s+trip\b/i;
const travelWordPattern =
  /\b(?:trips?|vacations?|holidays?|getaways?|honeymoons?|cruises?|safaris?|road\s*trips?|weekends?)\b/i;
const albumPattern = /\balbum\b/i;
const highlightPattern = /\b(?:top|best|highlights?|favorite|pick|choose)\b/i;
const nonGenericPattern =
  /\b(?:add|invite|shared\s+space|set\s+the\s+description|set\s+description|metadata|rotate|archive|tag)\b/i;
const questionOnlyPattern = /^\s*(?:how many|what|which|when|where|who|why|can you tell me)\b/i;
const explicitAlbumNamePattern = /\b(?:called|named|as)\s+(?:"([^"]+)"|'([^']+)'|(.+?))\s*[.?!]?$/i;
const placePhrasePattern = /\brecent\s+trip\s+(?:to|in)\s+(.+?)\s*(?:\b(?:called|named|as)\b|[?!]|$)/i;
const placeBeforeTravelPattern =
  /\b(?:my|our|the)?\s*([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,5})\s+(?:trips?|vacations?|holidays?|getaways?|honeymoons?|cruises?|safaris?)\b/;
const placeAfterTravelPattern =
  /\b(?:trips?|vacations?|holidays?|getaways?|honeymoons?|cruises?|safaris?)\s+(?:photos?|pics?|pictures?|shots?)?\s*(?:from|to|in)\s+(.+?)\s*(?:\b(?:called|named|as|in|into|to)\b|[?!]|$)/i;
const weekendPlacePattern = /\bweekend\s+(?:in|at)\s+(.+?)\s*(?:\b(?:called|named|as|in|into|to)\b|[?!]|$)/i;
const uncertainPlacePattern = /^(?:somewhere|somewhere nice|there|that place|the trip|my trip)$/i;
const monthWordPattern =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const seasonWordPattern = 'spring|summer|fall|autumn|winter';
const temporalPlacePattern = new RegExp(
  `^(?:(?:last|this|next)\\s+(?:day|week|weekend|month|year|${seasonWordPattern})|today|yesterday|tomorrow|recent|recently|(?:${seasonWordPattern})(?:\\s+20\\d{2})?|(?:${monthWordPattern})(?:\\s+20\\d{2})?|20\\d{2})$`,
  'i',
);

const cleanSlot = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[.?!]+$/g, '')
    .replace(/^the\s+/i, '')
    .trim();

const cleanAlbumName = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePlaceHint = (value) => {
  const cleaned = cleanSlot(value);
  if (!cleaned || uncertainPlacePattern.test(cleaned) || temporalPlacePattern.test(cleaned)) {
    return undefined;
  }

  if (/^(?:USA|U\.S\.?|US|United States|the United States)$/i.test(cleaned)) {
    return 'USA';
  }

  return cleaned.length <= 80 ? cleaned : undefined;
};

const extractPlaceHint = (prompt) => {
  const match =
    prompt.match(placePhrasePattern) ??
    prompt.match(placeBeforeTravelPattern) ??
    prompt.match(placeAfterTravelPattern) ??
    prompt.match(weekendPlacePattern);
  return match ? normalizePlaceHint(match[1]) : undefined;
};

// Slot-normalization helpers shared by the protocol adapter's parseSlots so it
// reuses the same place/album normalization rather than duplicating the regexes.
export const normalizePlaceHintSlot = (value) => normalizePlaceHint(value);

export const normalizeAlbumNameSlot = (value) => {
  const cleaned = cleanAlbumName(value);
  return cleaned.length > 0 ? cleaned : undefined;
};

const extractAlbumName = (prompt, placeHint) => {
  const explicit = prompt.match(explicitAlbumNamePattern);
  if (explicit) {
    return cleanAlbumName(explicit[1] ?? explicit[2] ?? explicit[3]);
  }

  return placeHint ? `${placeHint} Trip` : 'Recent Trip';
};

const stripExplicitAlbumNameClause = (prompt) => prompt.replace(explicitAlbumNamePattern, '');

export const matchStrictWorkflow = (prompt) => {
  const text = String(prompt ?? '').trim();
  if (!text) {
    return unsupported;
  }

  // `nonGenericPattern`/`highlightPattern` are fast-path CONSERVATISM guards, not
  // a terminal "unsupported" verdict (Slice 4): a declined `match` now flows into
  // the LLM classifier, which picks the dominant intent or returns `none`. They
  // stay so the regex fast-path never over-matches compound prompts (e.g.
  // "...and add them to Family") before the classifier sees them. Both run on the
  // album-name-stripped text so an explicit name like "called Travel Tag" — whose
  // words ("tag") would otherwise trip `nonGenericPattern` — still matches here.
  const requestText = stripExplicitAlbumNameClause(text);
  const hasCanonicalRecentTrip = creationPhrasePattern.test(text) && recentTripPattern.test(text);
  const hasTravelAlbumParaphrase = travelWordPattern.test(text) && throwIntoNewAlbumPattern.test(text);
  if (
    !(hasCanonicalRecentTrip || hasTravelAlbumParaphrase) ||
    !albumPattern.test(text) ||
    highlightPattern.test(requestText) ||
    nonGenericPattern.test(requestText) ||
    questionOnlyPattern.test(text)
  ) {
    return unsupported;
  }

  const placeHint = extractPlaceHint(text);
  const albumName = extractAlbumName(text, placeHint);
  if (!albumName) {
    return unsupported;
  }

  return placeHint
    ? { kind: 'create_recent_trip_album', albumName, placeHint }
    : { kind: 'create_recent_trip_album', albumName };
};

const assertCreateRecentTripWorkflow = (workflow) => {
  if (workflow?.kind !== 'create_recent_trip_album') {
    throw new Error('runCreateRecentTripAlbumWorkflow requires a create_recent_trip_album workflow');
  }
};

const tripCandidateDateRange = (candidate) => {
  const after = new Date(candidate.takenAfter);
  const before = new Date(candidate.takenBefore);
  const month = after.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  return `${month} ${after.getUTCDate()}-${before.getUTCDate()}, ${before.getUTCFullYear()}`;
};

const tripCandidateLabel = (candidate) =>
  Array.isArray(candidate.placeLabels) && candidate.placeLabels.length > 0
    ? candidate.placeLabels.join(' and ')
    : candidate.title?.replace(/^Recent trip to\s+/i, '') || candidate.subtitle || 'that trip';

export const strictWorkflowPendingTtlMs = 10 * 60 * 1000;

const optionalString = (value) => (typeof value === 'string' && value.length > 0 ? value : undefined);
const optionalNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

const compactPlaceLabels = (placeLabels) =>
  Array.isArray(placeLabels) ? placeLabels.filter((label) => typeof label === 'string' && label.length > 0).slice(0, 5) : [];

const compactSelectionHandle = (selectionHandle) => {
  const id = optionalString(selectionHandle?.id);
  if (!id) {
    return undefined;
  }

  const assetCount = optionalNumber(selectionHandle?.assetCount);
  return assetCount === undefined ? { id } : { id, assetCount };
};

const createRecentTripContinuationCandidate = (candidate) => ({
  dedupeKey: optionalString(candidate?.dedupeKey),
  title: optionalString(candidate?.title),
  subtitle: optionalString(candidate?.subtitle),
  takenAfter: optionalString(candidate?.takenAfter),
  takenBefore: optionalString(candidate?.takenBefore),
  albumAssetCount: optionalNumber(candidate?.albumAssetCount),
  excludedDuplicateCount: optionalNumber(candidate?.excludedDuplicateCount),
  excludedStackChildCount: optionalNumber(candidate?.excludedStackChildCount),
  placeLabels: compactPlaceLabels(candidate?.placeLabels),
  selectionHandle: compactSelectionHandle(candidate?.selectionHandle),
});

const candidateChoiceLabel = (candidate, index) => {
  const continuationCandidate = createRecentTripContinuationCandidate(candidate);
  return {
    index: index + 1,
    dedupeKey: continuationCandidate.dedupeKey,
    label: tripCandidateLabel(continuationCandidate),
    candidate: continuationCandidate,
  };
};

const normalizeChoiceText = (value) =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const explicitAlbumNameFromPrompt = (prompt) => {
  const explicit = String(prompt ?? '').match(explicitAlbumNamePattern);
  return explicit ? cleanAlbumName(explicit[1] ?? explicit[2] ?? explicit[3]) : undefined;
};

const ordinalChoice = (prompt) => {
  const text = normalizeChoiceText(prompt);
  if (/\b(?:1|first)\b/.test(text)) return 1;
  if (/\b(?:2|second)\b/.test(text)) return 2;
  if (/\b(?:3|third)\b/.test(text)) return 3;
  if (/\b(?:4|fourth)\b/.test(text)) return 4;
  if (/\b(?:5|fifth)\b/.test(text)) return 5;
  return undefined;
};

const yesChoicePattern = /^(?:yes|yeah|yep|use it|use that|that one|ok|okay)$/i;

const choiceTextForCandidate = (choice) =>
  [choice.label, choice.candidate.title, choice.candidate.subtitle, ...(choice.candidate.placeLabels ?? [])]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .flatMap((value) => [value, ...value.split(',')])
    .map(normalizeChoiceText)
    .filter((value) => value.length > 0);

const normalizedSelectionPrompt = (prompt) =>
  normalizeChoiceText(stripExplicitAlbumNameClause(String(prompt ?? ''))).replace(
    /^(?:use|choose|select|pick)\s+/,
    '',
  );

export const createRecentTripCandidateSelectionState = ({ workflow, candidates, nowMs = Date.now() }) => ({
  kind: 'create_recent_trip_album_candidate_selection',
  workflow,
  createdAtMs: nowMs,
  candidates: candidates.map(candidateChoiceLabel).slice(0, 5),
});

export const resolveRecentTripCandidateSelection = ({
  pending,
  prompt,
  nowMs = Date.now(),
  ttlMs = strictWorkflowPendingTtlMs,
}) => {
  if (pending?.kind !== 'create_recent_trip_album_candidate_selection') {
    return {
      status: 'missing',
      text: 'I no longer have pending recent trip choices. Please rerun the recent trip album request.',
    };
  }

  if (nowMs - pending.createdAtMs > ttlMs) {
    return { status: 'expired', text: 'Those pending trip choices expired. Please rerun the recent trip album request.' };
  }

  const requestedAlbumName = explicitAlbumNameFromPrompt(prompt);
  const normalizedPrompt = normalizedSelectionPrompt(prompt);
  let choice;
  const ordinal = ordinalChoice(prompt);
  if (ordinal !== undefined) {
    choice = pending.candidates.find((candidate) => candidate.index === ordinal);
  } else if (pending.candidates.length === 1 && yesChoicePattern.test(String(prompt ?? '').trim())) {
    choice = pending.candidates[0];
  } else if (normalizedPrompt.length > 0) {
    const matches = pending.candidates.filter((candidate) =>
      choiceTextForCandidate(candidate).some(
        (label) => normalizedPrompt.includes(label) || label.includes(normalizedPrompt),
      ),
    );
    if (matches.length === 1) {
      choice = matches[0];
    }
  }

  if (!choice) {
    const labels = pending.candidates.map((candidate) => candidate.label).join('; ');
    return { status: 'needs_input', text: `Which recent trip should I use: ${labels}?` };
  }

  return {
    status: 'matched',
    workflow: requestedAlbumName ? { ...pending.workflow, albumName: requestedAlbumName } : pending.workflow,
    candidate: choice.candidate,
  };
};

const tripDuplicateParts = (candidate) => {
  const duplicateCount = candidate.excludedDuplicateCount ?? 0;
  const stackCount = candidate.excludedStackChildCount ?? 0;
  const parts = [];
  if (duplicateCount > 0) {
    parts.push(`${duplicateCount} known duplicate variant${duplicateCount === 1 ? '' : 's'}`);
  }
  if (stackCount > 0) {
    parts.push(`${stackCount} stack child${stackCount === 1 ? '' : 'ren'}`);
  }
  return parts;
};

const duplicateExclusionText = (candidate) => {
  const parts = tripDuplicateParts(candidate);
  return parts.length > 0 ? ` I skipped ${parts.join(' and ')}.` : '';
};

const duplicateDescriptionText = (candidate) => {
  const parts = tripDuplicateParts(candidate);
  return parts.length > 0 ? ` ${parts.join(' and ')} were excluded when detected.` : '';
};

const extractPlanId = (toolResult) =>
  typeof toolResult?.planId === 'string'
    ? toolResult.planId
    : typeof toolResult?.plan?.id === 'string'
      ? toolResult.plan.id
      : undefined;

const workflowResult = (status, text, extra = {}) => ({ status, text, ...extra });

const redactSensitiveText = (value) =>
  String(value)
    .replace(/\bAuthorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bapi[_-]?key\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bapi-key\s+\S+/gi, 'api-key [redacted]')
    .replace(/\bpassword\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bsecret\s*[=:]\s*\S+/gi, (match) => match.replace(/\S+$/u, '[redacted]'))
    .replace(/\bsecret\s+value\s+\S+/gi, 'secret value [redacted]')
    .replace(/\bsecret[-_][A-Za-z0-9_-]+\b/gi, '[redacted]')
    .replace(/\btoken\s+[A-Za-z0-9._-]+\b/gi, 'token [redacted]');

const safeFailureText = (message) =>
  `I could not create a reviewable album plan. ${redactSensitiveText(
    message ?? 'Please try again or provide a more specific date range or place.',
  ).trim()}`;

const planFailureReason = (planResult) =>
  `The planning tool returned status "${planResult?.status ?? 'unknown'}" for proposeAlbumFromSelection.`;

const plannedResult = ({ planResult, candidate, workflow, label, assetCount, selectionHandleId }) => {
  if (planResult?.status === 'approval-required') {
    const toolCallId = planResult.toolCall?.id;
    if (typeof toolCallId === 'string' && toolCallId.length > 0) {
      return workflowResult('approval_required', '', { toolCallId, planResult, candidate, selectionHandleId, assetCount });
    }

    return workflowResult(
      'failed',
      safeFailureText('The planning tool requested approval without a usable tool call id.'),
      { planResult, candidate },
    );
  }

  if (planResult?.status && planResult.status !== 'success') {
    return workflowResult('failed', safeFailureText(planFailureReason(planResult)), { planResult, candidate });
  }

  const planId = extractPlanId(planResult);
  if (!planId) {
    return workflowResult('failed', safeFailureText('The planning tool did not return a persisted plan id.'), {
      planResult,
      candidate,
    });
  }

  return workflowResult(
    'planned',
    `I found a likely ${label} trip from ${tripCandidateDateRange(candidate)} and proposed ${workflow.albumName} with ${assetCount} assets.${duplicateExclusionText(candidate)} Review the plan before applying it.`,
    {
      planId,
      planResult,
      candidate,
      selectionHandleId,
      assetCount,
      successSummary: {
        workflowKind: 'create_recent_trip_album',
        albumName: workflow.albumName,
        label,
        dateRange: tripCandidateDateRange(candidate),
        assetCount,
        exclusions: tripDuplicateParts(candidate).join(' and ') || undefined,
      },
    },
  );
};

export const runCreateRecentTripAlbumWorkflow = async ({ client, workflow, approvedPlanResult, signal }) => {
  assertCreateRecentTripWorkflow(workflow);

  const tripResult = await client.call(
    'findTripCandidates',
    workflow.placeHint ? { placeHint: workflow.placeHint } : {},
    { signal },
  );
  const candidates = Array.isArray(tripResult.candidates) ? tripResult.candidates : [];
  const recommendation = tripResult.recommendation;

  if (recommendation?.action === 'none' || candidates.length === 0) {
    return workflowResult(
      'needs_input',
      'I could not find a likely recent trip from the available date and location metadata. Which date range or place should I use for the album?',
    );
  }

  if (recommendation?.action === 'ask_user') {
    const labels = candidates.map(tripCandidateLabel).slice(0, 5).join('; ');
    return workflowResult(
      'needs_input',
      candidates.length === 1
        ? `I found one possible recent trip: ${labels}. Should I use it, or would you prefer to give me a date range or place?`
        : `I found multiple possible recent trips: ${labels}. Which one should I use?`,
      { candidates },
    );
  }

  const candidateDedupeKey = recommendation?.candidateDedupeKey;
  const candidate =
    typeof candidateDedupeKey === 'string'
      ? candidates.find((item) => item?.dedupeKey === candidateDedupeKey)
      : undefined;

  if (!candidate) {
    return workflowResult(
      'needs_input',
      'Gallery found trip candidates, but the recommended trip could not match an available candidate. Which date range or place should I use for the album?',
    );
  }

  return runCreateRecentTripAlbumCandidateWorkflow({ client, workflow, candidate, approvedPlanResult, signal });
};

export const runCreateRecentTripAlbumCandidateWorkflow = async ({
  client,
  workflow,
  candidate,
  approvedPlanResult,
  signal,
}) => {
  assertCreateRecentTripWorkflow(workflow);

  const continuationCandidate = createRecentTripContinuationCandidate(candidate);
  const selectionHandleId = continuationCandidate?.selectionHandle?.id;
  if (!selectionHandleId) {
    return workflowResult(
      'needs_input',
      'I found a trip candidate but could not get an album-ready selection handle. Please try again or give me a date range.',
    );
  }

  const assetCount = continuationCandidate.selectionHandle.assetCount ?? continuationCandidate.albumAssetCount ?? 0;
  if (assetCount <= 0) {
    return workflowResult(
      'needs_input',
      'I found the recommended trip, but it found no album-ready assets. Which date range or place should I use instead?',
      { candidate: continuationCandidate },
    );
  }

  const label = tripCandidateLabel(continuationCandidate);
  let planResult = approvedPlanResult;
  try {
    planResult =
      planResult ??
      (await client.call(
        'proposeAlbumFromSelection',
        {
          summary: `Create ${workflow.albumName} with ${assetCount} trip assets from ${label}.`,
          albumName: workflow.albumName,
          description: `Album-ready trip selection from ${label}.${duplicateDescriptionText(continuationCandidate)}`,
          selectionHandleId,
        },
        { signal },
      ));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return workflowResult('failed', safeFailureText(message), {
      candidate: continuationCandidate,
      selectionHandleId,
      assetCount,
    });
  }

  return plannedResult({ planResult, candidate: continuationCandidate, workflow, label, assetCount, selectionHandleId });
};
