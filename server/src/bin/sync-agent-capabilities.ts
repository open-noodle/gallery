#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const AGENT_CAPABILITY_MATRIX_RELATIVE_PATH = 'docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md';

export const AGENT_WORKFLOW_MANIFEST_RELATIVE_PATH = '../agent-runner/src/strict-workflows/manifest.generated.json';

export const GENERATED_WORKFLOWS_START_MARKER = '<!-- generated:workflows:start -->';
export const GENERATED_WORKFLOWS_END_MARKER = '<!-- generated:workflows:end -->';

export type WorkflowManifestEntry = {
  kind: string;
  flow: 'strict' | 'hybrid';
  title: string;
  requiredReadTools: readonly string[];
  planTool: string;
  matrixRow: {
    capability: string;
    tier: string;
    workflowOrBoundary: string;
  };
};

const flowLabel: Record<WorkflowManifestEntry['flow'], string> = {
  strict: 'Strict',
  hybrid: 'Hybrid',
};

const codeList = (values: readonly string[]): string => values.map((value) => `\`${value}\``).join(', ');

/**
 * Render a GFM table padded the way Prettier formats markdown tables: each column is
 * widened to the longest cell (header, body, or a 3-dash minimum separator). Producing
 * Prettier-shaped output here keeps the committed doc and the `--check` comparison in
 * lockstep without depending on Prettier at runtime.
 */
const renderMarkdownTable = (header: readonly string[], rows: readonly (readonly string[])[]): string => {
  const widths = header.map((cell, column) => Math.max(3, cell.length, ...rows.map((row) => row[column]?.length ?? 0)));
  const renderRow = (cells: readonly string[]) =>
    `| ${cells.map((cell, column) => cell.padEnd(widths[column])).join(' | ')} |`;
  const separator = `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`;

  return [renderRow(header), separator, ...rows.map((row) => renderRow(row))].join('\n');
};

export const renderImplementedWorkflowsBlock = (manifest: readonly WorkflowManifestEntry[]): string => {
  const table = renderMarkdownTable(
    ['Kind', 'Flow', 'Required read tools', 'Plan tool'],
    manifest.map((entry) => [
      `\`${entry.kind}\``,
      flowLabel[entry.flow],
      codeList(entry.requiredReadTools),
      `\`${entry.planTool}\``,
    ]),
  );

  return [
    '### Implemented strict/hybrid workflows',
    '',
    'Generated from `agent-runner/src/strict-workflows/manifest.generated.json`. Do not edit by hand; run `pnpm --dir server sync:agent-capabilities`.',
    '',
    table,
    '',
  ].join('\n');
};

export const applyGeneratedWorkflowsBlock = (markdown: string, block: string): string => {
  const start = markdown.indexOf(GENERATED_WORKFLOWS_START_MARKER);
  const end = markdown.indexOf(GENERATED_WORKFLOWS_END_MARKER);

  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Generated-workflows markers not found in ${AGENT_CAPABILITY_MATRIX_RELATIVE_PATH}. Add the ${GENERATED_WORKFLOWS_START_MARKER} / ${GENERATED_WORKFLOWS_END_MARKER} pair.`,
    );
  }

  const before = markdown.slice(0, start + GENERATED_WORKFLOWS_START_MARKER.length);
  const after = markdown.slice(end);

  return `${before}\n\n${block}\n${after}`;
};

export const readWorkflowManifest = (): WorkflowManifestEntry[] => {
  const manifestPath = resolve(process.cwd(), AGENT_WORKFLOW_MANIFEST_RELATIVE_PATH);
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as WorkflowManifestEntry[];
};

export const renderCapabilityMatrix = (markdown: string, manifest: readonly WorkflowManifestEntry[]): string =>
  applyGeneratedWorkflowsBlock(markdown, renderImplementedWorkflowsBlock(manifest));

const sync = (): void => {
  const check = process.argv.includes('--check');
  const docPath = resolve(process.cwd(), '..', AGENT_CAPABILITY_MATRIX_RELATIVE_PATH);
  const current = readFileSync(docPath, 'utf8');
  const manifest = readWorkflowManifest();
  const next = renderCapabilityMatrix(current, manifest);

  if (check) {
    if (current !== next) {
      console.error(`${AGENT_CAPABILITY_MATRIX_RELATIVE_PATH} is out of date. Run sync:agent-capabilities.`);
      process.exit(1);
    }
    return;
  }

  if (current === next) {
    console.log(`${AGENT_CAPABILITY_MATRIX_RELATIVE_PATH} already up to date`);
    return;
  }

  writeFileSync(docPath, next, 'utf8');
  console.log(`Wrote ${AGENT_CAPABILITY_MATRIX_RELATIVE_PATH}`);
};

const invokedAs = process.argv[1] ?? '';
if (/sync-agent-capabilities(\.(?:ts|js))?$/.test(invokedAs)) {
  sync();
}
