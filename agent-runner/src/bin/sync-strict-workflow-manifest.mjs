#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_MANIFEST } from '../strict-workflows/manifest.mjs';

const target = fileURLToPath(new URL('../strict-workflows/manifest.generated.json', import.meta.url));
const next = `${JSON.stringify(WORKFLOW_MANIFEST, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = '';
  }
  if (current !== next) {
    console.error('manifest.generated.json is out of date. Run sync-strict-workflow-manifest.');
    process.exit(1);
  }
} else {
  writeFileSync(target, next, 'utf8');
  console.log('Wrote manifest.generated.json');
}
