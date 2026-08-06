// Scoring + reporting for the eval harness. Deterministic decisions (regex /
// heuristic) are scored once; model-dependent decisions are repeated `runs`
// times and scored as a pass-rate against a threshold (absorbs LLM variance).

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const lc = (v) => String(v ?? '').toLowerCase();

// L3 turns are always strings; L2 widened a turn to also allow an approval
// (`{ approve: boolean }`) or a clock advance (`{ advanceMs: number }`).
// Render those readably instead of the default `[object Object]` — string
// turns are untouched so L3 output (and existing scorecards) don't change.
const renderTurn = (turn) => {
  if (typeof turn === 'string') return turn;
  if (turn && typeof turn.advanceMs === 'number') return `+${turn.advanceMs}ms`;
  if (turn && typeof turn.approve === 'boolean') return `approve:${turn.approve}`;
  return String(turn);
};

const slotMatches = (parsed, expected) => {
  for (const [key, want] of Object.entries(expected)) {
    const got = parsed?.[key];
    if (want instanceof RegExp) {
      if (!want.test(got ?? '')) return false;
    } else if (lc(got) !== lc(want)) {
      return false;
    }
  }
  return true;
};

export const classificationPass = (decision, expect) => {
  const kinds = expect.anyKind ?? [expect.kind];
  if (!kinds.includes(decision.kind)) return false;

  // The L2 checks run BEFORE the kind==='none' short-circuit: a negative scenario
  // still has to prove that no tools ran and no plan was proposed, which is the
  // entire point of asserting it.

  // The no-raw-asset-IDs invariant. Deliberately NOT opt-in — Gallery prunes
  // `assetIds` from provider-facing planning schemas, so a leak is a regression
  // no matter what the scenario asked about.
  if (decision.rawAssetIdLeak) return false;

  // Exact, ordered tool-call sequence. Order- and length-sensitive: this is what
  // catches a redundant read call that a subset check would miss.
  if (expect.toolSequence !== undefined) {
    const got = decision.toolSequence ?? [];
    if (got.length !== expect.toolSequence.length) return false;
    if (got.some((name, i) => name !== expect.toolSequence[i])) return false;
  }
  // Subset match on operation `type`. Extra ops do not fail, so a scenario
  // asserts only what it cares about.
  if (expect.planOps !== undefined) {
    const types = new Set((decision.planOps ?? []).map((op) => op?.type));
    if (expect.planOps.some((type) => !types.has(type))) return false;
  }
  // Assert nothing was proposed (handoff / failed / needs_input / negative arms).
  if (expect.noPlan === true && (decision.planProposed === true || decision.planId)) return false;

  if (decision.kind === 'none') return true; // negative assertion: "none" is the whole check
  if (expect.slotsSurvive && decision.parsedSlots === null) return false;
  if (expect.slots && !slotMatches(decision.parsedSlots, expect.slots)) return false;
  if (expect.minOutcomeCount !== undefined && Number(decision.outcomeCount ?? 0) < expect.minOutcomeCount) return false;
  if (expect.minTurnsWithOutcome !== undefined && Number(decision.turnsWithOutcome ?? 0) < expect.minTurnsWithOutcome) {
    return false;
  }
  if (expect.outcomeStatus !== undefined) {
    const statuses = Array.isArray(expect.outcomeStatus) ? expect.outcomeStatus : [expect.outcomeStatus];
    if (!statuses.includes(decision.outcomeStatus)) return false;
  }
  // L3 plan-proposed assertion: did the strict workflow actually propose a
  // (never-applied) plan? Only checked when the scenario opts in.
  if (expect.planProposed !== undefined && Boolean(decision.planProposed) !== expect.planProposed) return false;
  return true;
};

const copyPass = (text, expect) => {
  const t = lc(text);
  for (const c of expect.contains ?? []) if (!t.includes(lc(c))) return false;
  for (const c of expect.notContains ?? []) if (t.includes(lc(c))) return false;
  return true;
};

export const evalScenario = async (driver, sc, defaultRuns) => {
  // Default 0.6 so a clean 2-of-3 (0.667) clears it; raise per-scenario for
  // must-always-hold cases.
  const threshold = sc.threshold ?? 0.6;
  const maxRuns = sc.runs ?? defaultRuns;
  const isCopy = sc.category === 'copy';
  const latencies = [];
  let attempts = 0;
  let passes = 0;
  let survived = 0;
  let slotsTracked = false;
  let lastDetail;

  for (let i = 0; i < maxRuns; i++) {
    const t0 = performance.now();
    let ok = false;
    let deterministic = false;
    if (isCopy) {
      const text = await driver.polishCopy(sc.summary);
      ok = copyPass(text, sc.expect);
      lastDetail = { text };
    } else {
      // Multi-turn scenarios (`turns: [...]`) drive a single session across
      // several user messages (e.g. ask_user -> follow-up). L1 has no converse().
      const decision =
        sc.turns && driver.converse ? await driver.converse(sc.turns) : await driver.classify(sc.prompt);
      ok = classificationPass(decision, sc.expect);
      // `undefined` means the layer can't observe slots (L3's scrubbed events);
      // `null` means slots were rejected; an object means they survived.
      if (decision.parsedSlots !== undefined) {
        slotsTracked = true;
        if (decision.parsedSlots !== null) survived++;
      }
      deterministic = decision.via === 'regex' || decision.via === 'heuristic';
      lastDetail = {
        kind: decision.kind,
        via: decision.via,
        confidence: decision.confidence,
        slots: decision.slots,
        parsedSlots: decision.parsedSlots,
        planProposed: decision.planProposed,
        outcomeStatus: decision.outcomeStatus,
        outcomeCount: decision.outcomeCount,
        turnsWithOutcome: decision.turnsWithOutcome,
        // L2-only: undefined on L1/L3 (neither driver sets them), so the
        // scorecard's failure rendering must degrade cleanly when absent.
        toolSequence: decision.toolSequence,
        planOps: decision.planOps,
      };
    }
    attempts++;
    if (ok) passes++;
    latencies.push(performance.now() - t0);
    // Regex/heuristic outcomes never vary — one run is the whole truth.
    if (deterministic) break;
  }

  const score = passes / attempts;
  return {
    id: sc.id,
    category: sc.category,
    prompt: sc.prompt ?? (sc.turns ? sc.turns.map(renderTurn).join(' → ') : undefined),
    score,
    passed: score >= threshold,
    threshold,
    attempts,
    slotSurvival: isCopy || !slotsTracked ? null : survived / attempts,
    meanLatencyMs: Math.round(avg(latencies)),
    detail: lastDetail,
    expect: sc.expect,
  };
};

export const aggregate = (results) => {
  const byCategory = {};
  for (const r of results) {
    const c = (byCategory[r.category] ??= { total: 0, passed: 0, scoreSum: 0, survivalSum: 0, survivalN: 0 });
    c.total++;
    if (r.passed) c.passed++;
    c.scoreSum += r.score;
    if (r.slotSurvival !== null) {
      c.survivalSum += r.slotSurvival;
      c.survivalN++;
    }
  }
  for (const c of Object.values(byCategory)) {
    c.meanScore = c.scoreSum / c.total;
    c.slotSurvival = c.survivalN ? c.survivalSum / c.survivalN : null;
  }
  const overall = results.length ? results.reduce((a, r) => a + r.score, 0) / results.length : 0;
  return {
    overall,
    passedCount: results.filter((r) => r.passed).length,
    total: results.length,
    byCategory,
    scenarioScores: Object.fromEntries(results.map((r) => [r.id, Number(r.score.toFixed(3))])),
  };
};

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const showExpect = (expect) => JSON.stringify(expect, (_k, v) => (v instanceof RegExp ? v.toString() : v));

export const renderScorecard = (agg, results, meta) => {
  const lines = [];
  lines.push(`# Pi agent eval scorecard`);
  lines.push('');
  lines.push(
    `${meta.layer ? `layer=${meta.layer}  ·  ` : ''}model: \`${meta.model}\` @ ${meta.baseUrl}  ·  router=${meta.routerMode}  ·  runs=${meta.runs}`,
  );
  lines.push('');
  lines.push(`**overall ${pct(agg.overall)}**  ·  ${agg.passedCount}/${agg.total} scenarios passed`);
  lines.push('');
  lines.push('| Category | passed | mean score | slot survival |');
  lines.push('| --- | --- | --- | --- |');
  for (const [cat, c] of Object.entries(agg.byCategory).sort()) {
    lines.push(`| ${cat} | ${c.passed}/${c.total} | ${pct(c.meanScore)} | ${c.slotSurvival === null ? '—' : pct(c.slotSurvival)} |`);
  }
  const failures = results.filter((r) => !r.passed);
  if (failures.length) {
    lines.push('');
    lines.push(`## Failures (${failures.length})`);
    for (const f of failures) {
      const d = f.detail ?? {};
      const planBit =
        d.planProposed === undefined
          ? ''
          : ` planProposed=${d.planProposed} outcome=${d.outcomeStatus ?? '—'} outcomeCount=${d.outcomeCount ?? '—'} turnsWithOutcome=${d.turnsWithOutcome ?? '—'}`;
      // L2-only: L1/L3 never set toolSequence/planOps, so both stay blank there —
      // this must degrade cleanly rather than printing the literal word
      // "undefined". toolSequence prints whenever the layer observed one at all
      // (including an empty array, which is itself diagnostic for a negative
      // scenario); planOps only prints when it actually carries operations.
      const toolBit = d.toolSequence === undefined ? '' : ` toolSequence=${JSON.stringify(d.toolSequence)}`;
      const planOpsBit =
        Array.isArray(d.planOps) && d.planOps.length > 0
          ? ` planOps=${JSON.stringify(d.planOps.map((op) => op?.type ?? op))}`
          : '';
      const got =
        f.category === 'copy'
          ? JSON.stringify(d.text)
          : `kind=${d.kind} via=${d.via} parsedSlots=${JSON.stringify(d.parsedSlots)}${planBit}${toolBit}${planOpsBit}`;
      lines.push(`- \`${f.id}\` (${pct(f.score)} < ${pct(f.threshold)}) — "${f.prompt ?? f.id}"`);
      lines.push(`  - expect: ${showExpect(f.expect)}`);
      lines.push(`  - got: ${got}`);
    }
  }
  return lines.join('\n');
};

export const diffBaseline = (agg, baseline) => {
  const lines = ['', '## Baseline diff'];
  const dOverall = agg.overall - (baseline.overall ?? 0);
  lines.push(`overall ${pct(baseline.overall ?? 0)} -> ${pct(agg.overall)} (${dOverall >= 0 ? '+' : ''}${(dOverall * 100).toFixed(1)}pp)`);
  const regressions = [];
  const improvements = [];
  for (const [id, score] of Object.entries(agg.scenarioScores)) {
    const before = baseline.scenarioScores?.[id];
    if (before === undefined) continue;
    const d = score - before;
    if (d <= -0.001) regressions.push(`  - ⚠ ${id}: ${pct(before)} -> ${pct(score)}`);
    else if (d >= 0.001) improvements.push(`  - ${id}: ${pct(before)} -> ${pct(score)}`);
  }
  lines.push(`regressions: ${regressions.length}, improvements: ${improvements.length}`);
  if (regressions.length) lines.push('', 'Regressions:', ...regressions);
  return lines.join('\n');
};

export const toBaseline = (agg, meta) => ({
  model: meta.model,
  overall: Number(agg.overall.toFixed(3)),
  byCategory: Object.fromEntries(Object.entries(agg.byCategory).map(([k, c]) => [k, Number(c.meanScore.toFixed(3))])),
  scenarioScores: agg.scenarioScores,
});
