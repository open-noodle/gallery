import type { AuditResult, ClassifiedCommit } from './types';

export type ExtensionHotspot = {
  path: string;
  hits: number;
  features: string[];
};

export type DomainOverlap = {
  domain: string;
  files: string[];
};

export type FeatureOverlap = {
  feature: string;
  commits: string[];
  files: string[];
};

export type PreflightReportInput = {
  date: string;
  mergeBase: string;
  upstreamShortStat: string;
  forkShortStat: string;
  classifiedCommits: ClassifiedCommit[];
  incomingCommits: ClassifiedCommit[];
  forkFileCount: number;
  upstreamFileCount: number;
  overlapFiles: string[];
  domainOverlaps: DomainOverlap[];
  featureOverlaps: FeatureOverlap[];
  dependencyChanges: string[];
  serverMigrationChanges: string[];
  serverTableOverlaps: string[];
  mobileDriftChanges: string[];
  ciWorkflowChanges: string[];
  broadRefactorHints: string[];
  batchMarkdown: string;
  auditResults: AuditResult[];
  extensionHotspots: ExtensionHotspot[];
};

export function renderPreflightMarkdown(input: PreflightReportInput): string {
  const highRiskRows = input.classifiedCommits
    .filter((commit) => commit.risk === 'high')
    .sort(
      (left, right) =>
        right.overlapFiles.length - left.overlapFiles.length ||
        right.reasons.length - left.reasons.length,
    )
    .map(
      (commit) =>
        `| \`${commit.shortSha}\` | ${commit.subject} | ${commit.domains.join(', ')} | ${commit.features.join(', ') || '-'} | ${commit.requiredChecks.join(', ') || '-'} | ${commit.reasons.join('; ')} |`,
    )
    .join('\n');
  const auditRows = input.auditResults
    .map(
      (audit) =>
        `| ${audit.ok ? 'OK' : 'ISSUE'} | ${audit.title} | ${audit.details.join('<br>')} |`,
    )
    .join('\n');
  const hotspotRows = input.extensionHotspots
    .map(
      (hotspot) =>
        `| \`${hotspot.path}\` | ${hotspot.hits} | ${hotspot.features.join(', ')} |`,
    )
    .join('\n');
  const incomingRows = input.incomingCommits
    .map(
      (commit) =>
        `| \`${commit.shortSha}\` | ${commit.subject} | ${commit.domains.join(', ') || '-'} | ${commit.risk.toUpperCase()} |`,
    )
    .join('\n');
  const domainRows = input.domainOverlaps
    .map(
      (overlap) =>
        `| ${overlap.domain} | ${overlap.files.length} | ${overlap.files.map((file) => `\`${file}\``).join('<br>')} |`,
    )
    .join('\n');
  const featureRows = input.featureOverlaps
    .map(
      (overlap) =>
        `| ${overlap.feature} | ${overlap.commits.join(', ')} | ${overlap.files.map((file) => `\`${file}\``).join('<br>')} |`,
    )
    .join('\n');
  const listOrNone = (items: string[]) =>
    items.length > 0
      ? items.map((item) => `- \`${item}\``).join('\n')
      : '- None';

  return `# Upstream Preflight Report - ${input.date}

## Summary

- **Merge base**: \`${input.mergeBase}\`
- **Incoming upstream files**: ${input.upstreamFileCount}
- **Incoming upstream commits**: ${input.incomingCommits.length}
- **Fork delta files**: ${input.forkFileCount}
- **Direct overlap files**: ${input.overlapFiles.length}
- **Incoming upstream diff**: ${input.upstreamShortStat || 'no changes'}
- **Fork diff**: ${input.forkShortStat || 'no changes'}

## High-Risk Commits

| SHA | Subject | Domains | Features | Required Checks | Reasons |
| --- | --- | --- | --- | --- | --- |
${highRiskRows || '| - | None | - | - | - | - |'}

## Incoming Commit List

| SHA | Subject | Domains | Risk |
| --- | --- | --- | --- |
${incomingRows || '| - | None | - | - |'}

## Overlap By Domain

| Domain | Files | Paths |
| --- | ---: | --- |
${domainRows || '| - | 0 | - |'}

## Overlap By Manifest Feature

| Feature | Commits | Files |
| --- | --- | --- |
${featureRows || '| - | - | - |'}

## Dependency And Lockfile Changes

${listOrNone(input.dependencyChanges)}

## Server Migration Signals

${listOrNone(input.serverMigrationChanges)}

## Server Table Overlap Signals

${listOrNone(input.serverTableOverlaps)}

## Mobile Drift Signals

${listOrNone(input.mobileDriftChanges)}

## CI Workflow Signals

${listOrNone(input.ciWorkflowChanges)}

## Broad Refactor Hints

${input.broadRefactorHints.length > 0 ? input.broadRefactorHints.map((hint) => `- ${hint}`).join('\n') : '- None'}

## Audit Signals

| Status | Check | Details |
| --- | --- | --- |
${auditRows || '| OK | No audit signals | - |'}

## Recommended Batch Plan

${input.batchMarkdown}

## Fork Surface Reduction Signals

| Upstream Extension Path | Incoming Touch Count | Features |
| --- | ---: | --- |
${hotspotRows || '| - | 0 | - |'}
`;
}
