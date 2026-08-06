// Eval harness CLI.
//
//   node eval/run.mjs                 run all L1 scenarios, print scorecard
//   node eval/run.mjs --layer L3      run the live read-only scenarios (Gallery API)
//   node eval/run.mjs --filter trip   only scenarios whose id/category contains "trip"
//   node eval/run.mjs --runs 5        override repeats per scenario
//   node eval/run.mjs --mode regex    force router mode (regex|llm|hybrid) [L1 only]
//   node eval/run.mjs --diff          compare against the layer's baseline
//   node eval/run.mjs --accept        write the current scorecard as the baseline
//   node eval/run.mjs --json          also write eval/results/<iso>.json
//   node eval/run.mjs --layer L3 --keep-sessions   leave harness sessions for inspection
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import config from './config.mjs';
import l1Scenarios from './scenarios/index.mjs';
import l3Scenarios from './scenarios/l3-readonly.mjs';
import { createL1Driver } from './drivers/l1-component.mjs';
import { createL3Driver } from './drivers/l3-session.mjs';
import { evalScenario, aggregate, renderScorecard, diffBaseline, toBaseline } from './score.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const layer = (opt('layer', 'L1') || 'L1').toUpperCase();
const filter = opt('filter');
const routerMode = opt('mode', config.routerMode);
const log = (...m) => process.stderr.write(`${m.join(' ')}\n`);

if (layer !== 'L1' && layer !== 'L3') {
  log(`Unknown --layer "${layer}". Use L1 (default) or L3.`);
  process.exit(2);
}

const allScenarios = layer === 'L3' ? l3Scenarios : l1Scenarios;
const selected = filter
  ? allScenarios.filter((s) => s.id.includes(filter) || s.category === filter)
  : allScenarios;
const runs = Number(opt('runs', layer === 'L3' ? config.l3.runs : config.runs));
const baselinePath = join(here, layer === 'L3' ? 'baseline.l3.json' : 'baseline.json');

const checkLlamaConnectivity = async () => {
  try {
    const res = await fetch(`${config.llama.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.llama.secret}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    log(`\n✖ Cannot reach the model server at ${config.llama.baseUrl}`);
    log(`  ${error?.message ?? error}`);
    log(`  Start your local server or set EVAL_LLAMA_URL / EVAL_LLAMA_MODEL.\n`);
    process.exit(2);
  }
};

// Build the layer's driver and a meta block for the scorecard header. The L3
// driver runs a preflight (auth + credential resolution + runner validation)
// that throws with a readable message if the live stack isn't wired.
const buildDriver = async () => {
  if (layer === 'L3') {
    const keepSessions = flag('keep-sessions') || config.l3.keepSessions;
    const driver = createL3Driver({ gallery: config.gallery, l3: { ...config.l3, keepSessions } });
    let info;
    try {
      info = await driver.preflight();
    } catch (error) {
      log(`\n✖ L3 preflight failed against ${config.gallery.baseUrl}`);
      log(`  ${error?.message ?? error}`);
      log(`  Check GALLERY_URL + auth (GALLERY_API_KEY | GALLERY_TOKEN | GALLERY_EMAIL/PASSWORD),`);
      log(`  that the agent runner + model are reachable from the server, and that a provider`);
      log(`  credential exists (GALLERY_CREDENTIAL_ID / GALLERY_MODEL_URL).\n`);
      process.exit(2);
    }
    log(
      `L3 preflight OK · model=${info.model} · preset=${info.permissionPreset} · approval=${info.approvalMode} (read-only)`,
    );
    return { driver, meta: { model: driver.model, baseUrl: driver.baseUrl, routerMode: 'server', runs, layer: 'L3' } };
  }

  await checkLlamaConnectivity();
  const driver = createL1Driver({ llama: config.llama, routerMode });
  return { driver, meta: { model: driver.model, baseUrl: driver.baseUrl, routerMode, runs, layer: 'L1' } };
};

const main = async () => {
  const { driver, meta } = await buildDriver();

  log(`Running ${selected.length} ${layer} scenarios (runs<=${runs}) against ${driver.model}...`);
  const results = [];
  try {
    let done = 0;
    for (const sc of selected) {
      results.push(await evalScenario(driver, sc, runs));
      done++;
      if (done % 10 === 0 || done === selected.length) log(`  ${done}/${selected.length}`);
    }
  } finally {
    if (layer === 'L3') {
      // Read-only safety audit: assert the agent never applied a plan in any
      // session the harness created. Then tidy up those sessions.
      try {
        const offenders = await driver.auditNoApply();
        log(
          offenders.length === 0
            ? '✔ read-only audit: no plan was applied in any harness session'
            : `✖ read-only audit: applied plans found in sessions ${offenders.join(', ')}`,
        );
      } catch (error) {
        log(`  (read-only audit skipped: ${error?.message ?? error})`);
      }
      // Safety invariant: the success gate must never have fired (a claimed plan
      // with no persisted plan id). Observed from activity events during the run.
      const gateBlocks = driver.auditGateBlocks();
      log(
        gateBlocks.length === 0
          ? '✔ gate audit: no strict_success_gate_block in any harness session'
          : `✖ gate audit: success-gate blocks in sessions ${gateBlocks.join(', ')}`,
      );
      const { deleted, kept } = await driver.cleanup();
      log(`  cleanup: deleted ${deleted} session(s)${kept ? `, kept ${kept}` : ''}`);
    }
  }

  const agg = aggregate(results);
  const scorecard = renderScorecard(agg, results, meta);
  process.stdout.write(`${scorecard}\n`);

  if (flag('diff')) {
    if (existsSync(baselinePath)) {
      const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
      process.stdout.write(`${diffBaseline(agg, baseline)}\n`);
    } else {
      log(`No ${layer === 'L3' ? 'baseline.l3.json' : 'baseline.json'} yet; run with --accept to create one.`);
    }
  }
  if (flag('accept')) {
    writeFileSync(baselinePath, `${JSON.stringify(toBaseline(agg, meta), null, 2)}\n`);
    log(`Wrote baseline: ${baselinePath}`);
  }
  if (flag('json')) {
    const dir = join(here, 'results');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const out = join(dir, `${layer.toLowerCase()}-${stamp}.json`);
    writeFileSync(out, `${JSON.stringify({ meta, agg, results }, null, 2)}\n`);
    log(`Wrote results: ${out}`);
  }

  // Non-zero exit if any scenario failed, so the harness is CI/script friendly.
  process.exit(agg.passedCount === agg.total ? 0 : 1);
};

main().catch((error) => {
  log(`eval failed: ${error?.stack ?? error}`);
  process.exit(2);
});
