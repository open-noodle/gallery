import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AGENT_WORKFLOW_MANIFEST_RELATIVE_PATH,
  GENERATED_WORKFLOWS_END_MARKER,
  GENERATED_WORKFLOWS_START_MARKER,
  renderImplementedWorkflowsBlock,
  type WorkflowManifestEntry,
} from 'src/bin/sync-agent-capabilities';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import { AgentMcpToolRegistryService } from 'src/services/agent-mcp-tool-registry.service';

const readMatrix = () =>
  readFileSync(resolve(process.cwd(), '../docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md'), 'utf8');

const readManifest = (): WorkflowManifestEntry[] =>
  JSON.parse(readFileSync(resolve(process.cwd(), AGENT_WORKFLOW_MANIFEST_RELATIVE_PATH), 'utf8'));

const sectionBetween = (markdown: string, startHeading: string, endHeading: string) => {
  const start = markdown.indexOf(startHeading);
  expect(start).not.toBe(-1);
  const end = markdown.indexOf(endHeading, start + startHeading.length);
  expect(end).not.toBe(-1);
  return markdown.slice(start, end);
};

describe('Pi agent capability matrix', () => {
  it('documents completed search filter parity and acceptance prompts', () => {
    const markdown = readMatrix();
    const coreMatrix = sectionBetween(markdown, '## Core Capability Matrix', '## High-Value Constrained Capabilities');

    expect(markdown).toContain('Smart, OCR, description, filename, and metadata search');
    expect(markdown).toContain('resolveAssetSearchFilters');

    const naturalLanguageFilteredSearchRow = coreMatrix
      .split('\n')
      .find((line) => line.includes('Natural-language filtered search'));
    expect(naturalLanguageFilteredSearchRow).toContain('Solid now');

    for (const prompt of [
      'Find photos of Alex in Berlin from last summer that are not in any album.',
      'Create an album from 5-star videos from Japan.',
      'Find screenshots from 2024 that mention invoices.',
      'Add beach sunset photos from the Family space to a new album.',
      'Find photos taken with my Sony camera in May.',
    ]) {
      expect(markdown).toContain(prompt);
    }

    const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
    expect(needsNewToolHeadingIndex).not.toBe(-1);

    const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
    expect(needsNewToolSection).not.toContain('Natural-language semantic search');
    expect(needsNewToolSection).not.toContain('Large-library pagination');
    expect(markdown).toContain('Next expansion candidates: image straightening and export/download workflows');
    // Reversible trash + duplicate cleanup shipped — no longer new-tool gaps.
    expect(needsNewToolSection).not.toContain('| Trash/delete ');
    expect(needsNewToolSection).not.toContain('| Duplicate/similar-photo cleanup ');
  });

  it('documents explicit batch asset metadata edits and place-name geocoding as solid', () => {
    const markdown = readMatrix();
    const coreMatrix = sectionBetween(markdown, '## Core Capability Matrix', '## High-Value Constrained Capabilities');

    const metadataEditRow = coreMatrix.split('\n').find((line) => line.includes('Batch asset metadata edits'));
    expect(metadataEditRow).toBeDefined();
    expect(metadataEditRow).toContain('Solid now');
    expect(metadataEditRow).toContain('asset.updateMetadata');
    expect(metadataEditRow).toContain('description');
    expect(metadataEditRow).toContain('rating');
    expect(metadataEditRow).toContain('date/time');
    expect(metadataEditRow).toContain('timezone');
    expect(metadataEditRow).toContain('latitude/longitude');
    // Place names now resolve to coordinates via the forward geocoder.
    expect(metadataEditRow).toContain('resolveLocation');

    for (const prompt of [
      'Set the description on the 5 newest photos to Test batch.',
      'Clear the rating from this album.',
      'Shift these scanned photos forward by 2 hours.',
      'Set these photos to latitude 48.8566 and longitude 2.3522.',
      'Set these photos to Paris.',
    ]) {
      expect(markdown).toContain(prompt);
    }

    const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
    expect(needsNewToolHeadingIndex).not.toBe(-1);
    const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
    expect(needsNewToolSection).not.toContain('| Metadata edits ');
    // Forward geocoding shipped — place-name geocoding is no longer a new-tool gap.
    expect(needsNewToolSection).not.toContain('Place-name-to-coordinate metadata edits');
    expect(needsNewToolSection).not.toContain('No forward geocoder');
  });

  it('documents bounded highlight curation and visual cleanup with objective quality signals', () => {
    const markdown = readMatrix();
    const constrainedMatrix = sectionBetween(
      markdown,
      '## High-Value Constrained Capabilities',
      '## Needs New MCP Tool',
    );

    const bestPhotosRow = constrainedMatrix.split('\n').find((line) => line.includes('“Best photos” curation'));

    expect(bestPhotosRow).toBeDefined();
    expect(bestPhotosRow).toContain('Solid now for bounded sources');
    expect(bestPhotosRow).toMatch(/bounded candidates|bounded and reviewable/i);
    expect(bestPhotosRow).toMatch(/ratings|favorites|metadata|previews/i);
    expect(bestPhotosRow).toMatch(/objective quality scores/i);
    expect(bestPhotosRow).toMatch(/suggested highlights|curation/i);
    expect(bestPhotosRow).not.toContain('planned implementation');

    const visualCleanupRow = constrainedMatrix.split('\n').find((line) => line.includes('Visual cleanup'));
    expect(visualCleanupRow).toBeDefined();
    expect(visualCleanupRow).toContain('Solid now');
    expect(visualCleanupRow).toMatch(/objective quality scoring|sharpness|brightness/i);

    for (const prompt of [
      'Suggest 5 highlights from this album and make an album called Highlights.',
      'Favorite the best 3 photos from last weekend.',
      'Pick a cover from this album.',
      'Pick the best photos from my library.',
      'Suggest 20 highlights from this album.',
      'Suggest highlights from last weekend.',
    ]) {
      expect(markdown).toContain(prompt);
    }

    const needsNewToolHeadingIndex = markdown.indexOf('## Needs New MCP Tool');
    expect(needsNewToolHeadingIndex).not.toBe(-1);

    const needsNewToolSection = markdown.slice(needsNewToolHeadingIndex);
    expect(needsNewToolSection).not.toContain('Image quality scoring');
    expect(needsNewToolSection).not.toContain('analyzeAssetQuality');
  });

  it('documents the open and hybrid flow-ownership invariants for Pi capabilities', () => {
    const markdown = readMatrix();

    expect(markdown).toContain('## Flow Ownership Matrix');
    const flowSection = markdown.slice(markdown.indexOf('## Flow Ownership Matrix'));

    const searchRow = flowSection.split('\n').find((line) => line.includes('Natural-language filtered search'));
    expect(searchRow).toBeDefined();
    expect(searchRow).toContain('Open read flow');

    const highlightsRow = flowSection.split('\n').find((line) => line.includes('“Best photos” curation'));
    expect(highlightsRow).toBeDefined();
    expect(highlightsRow).toContain('Hybrid');

    expect(flowSection).toMatch(/no claimed plan unless a persisted plan id\s+exists/);
    expect(flowSection).toContain('selection handles for asset sets');
  });

  it('keeps the generated implemented-workflows block in sync with the manifest', () => {
    const markdown = readMatrix();
    const manifest = readManifest();

    const start = markdown.indexOf(GENERATED_WORKFLOWS_START_MARKER);
    const end = markdown.indexOf(GENERATED_WORKFLOWS_END_MARKER);
    expect(start).not.toBe(-1);
    expect(end).not.toBe(-1);
    expect(end).toBeGreaterThan(start);

    const managed = markdown.slice(start, end);
    expect(managed).toContain(renderImplementedWorkflowsBlock(manifest).trim());
  });

  it('agrees with the hand-authored Flow Ownership Matrix for every workflow', () => {
    const markdown = readMatrix();
    const manifest = readManifest();
    const flowSection = markdown.slice(markdown.indexOf('## Flow Ownership Matrix'));
    const flowLabel: Record<WorkflowManifestEntry['flow'], string> = { strict: 'Strict', hybrid: 'Hybrid' };

    for (const entry of manifest) {
      const row = flowSection.split('\n').find((line) => line.includes(entry.matrixRow.capability));
      expect(row, entry.kind).toBeDefined();
      expect(row).toContain(flowLabel[entry.flow]);
    }
  });

  it('only references read and plan tools that are registered MCP tools', () => {
    const manifest = readManifest();
    const registry = new AgentMcpToolRegistryService(new AgentMcpToolContractService());
    const registeredToolNames = new Set(registry.listTools().map((tool) => tool.name));

    for (const entry of manifest) {
      for (const readTool of entry.requiredReadTools) {
        expect(registeredToolNames, `${entry.kind} read tool ${readTool}`).toContain(readTool);
      }
      expect(registeredToolNames, `${entry.kind} plan tool ${entry.planTool}`).toContain(entry.planTool);
    }
  });
});
