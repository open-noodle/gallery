#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command()
  .name('gallery-upstream-preflight')
  .description('Gallery upstream rebase preflight and audit tooling');

for (const command of [
  'preflight',
  'batch-plan',
  'postrebase-audit',
  'mobile-drift-check',
  'ci-invariants-check',
  'fork-patches-check',
]) {
  program.command(command).action(() => {
    console.log(`${command} scaffold`);
  });
}

program.parse(process.argv);
