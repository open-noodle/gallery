import { describe, expect, it } from 'vitest';
import {
  mergeStatements,
  normalizeLineSpecifiers,
  normalizeModule,
  parseStatement,
  resolveConflictedSource,
  specifierKeys,
} from './import-merge';

const conflict = (ours: string, theirs: string) =>
  ['<<<<<<< HEAD', ours, '=======', theirs, '>>>>>>> upstream/main'].join('\n');

describe('normalizeModule', () => {
  it('appends .js to path-alias specifiers', () => {
    expect(normalizeModule('src/services/base.service')).toBe('src/services/base.service.js');
    expect(normalizeModule('test/utils')).toBe('test/utils.js');
    expect(normalizeModule('../schema/tables/person.table')).toBe('../schema/tables/person.table.js');
  });

  it('leaves bare package specifiers and already-suffixed paths alone', () => {
    expect(normalizeModule('node:fs')).toBe('node:fs');
    expect(normalizeModule('kysely')).toBe('kysely');
    expect(normalizeModule('lodash-es')).toBe('lodash-es');
    expect(normalizeModule('src/enum.js')).toBe('src/enum.js');
  });
});

describe('parseStatement', () => {
  it('parses named, default, namespace, type-only and side-effect forms', () => {
    expect(parseStatement("import { A, B as C } from 'src/enum';")).toMatchObject({
      kind: 'import', module: 'src/enum', typeOnly: false, named: ['A', 'B as C'],
    });
    expect(parseStatement("import type { JobOf } from 'src/types';")).toMatchObject({
      typeOnly: true, named: ['JobOf'],
    });
    expect(parseStatement("import * as fs from 'node:fs';")).toMatchObject({ namespaceName: 'fs' });
    expect(parseStatement("import React from 'react';")).toMatchObject({ defaultName: 'React' });
    expect(parseStatement("import 'reflect-metadata';")).toMatchObject({ sideEffectOnly: true });
  });

  it('refuses anything that is not an import/export-from statement', () => {
    expect(parseStatement('export const x = 1;')).toBeNull();
    expect(parseStatement('const y = 2;')).toBeNull();
  });
});

describe('mergeStatements', () => {
  it('unions named specifiers from the same module and normalizes the specifier', () => {
    const ours = [parseStatement("import { A } from 'src/enum';")!];
    const theirs = [parseStatement("import { B } from 'src/enum.js';")!];
    const merged = mergeStatements([ours, theirs])!;
    expect(merged).toHaveLength(1);
    expect(merged[0].module).toBe('src/enum.js');
    expect(merged[0].named).toEqual(['A', 'B']);
  });

  it('refuses when two sides disagree on a default binding', () => {
    const ours = [parseStatement("import A from 'src/x';")!];
    const theirs = [parseStatement("import B from 'src/x';")!];
    expect(mergeStatements([ours, theirs])).toBeNull();
  });
});

describe('resolveConflictedSource', () => {
  it('resolves an import-only region, preserving every specifier from both sides', () => {
    const source = [
      conflict(
        "import { AssetFileType } from 'src/enum';\nimport { BaseService } from 'src/services/base.service';",
        "import { AssetFileType, AssetStatus } from 'src/enum.js';\nimport { BaseService } from 'src/services/base.service.js';",
      ),
      '',
      'export class Foo {}',
    ].join('\n');

    const result = resolveConflictedSource(source);

    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).not.toContain('<<<<<<<');
    expect(result.text).toContain("import { AssetFileType, AssetStatus } from 'src/enum.js';");
    expect(result.text).toContain("import { BaseService } from 'src/services/base.service.js';");
    expect(result.text).toContain('export class Foo {}');
  });

  it('REFUSES a region containing non-import content and leaves it untouched', () => {
    const source = conflict(
      "import { A } from 'src/enum';\nconst forkOnly = 1;",
      "import { A } from 'src/enum.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).toContain('const forkOnly = 1;');
  });

  it('specifierKeys accounts for every binding on both sides', () => {
    const ours = [parseStatement("import { Kept } from 'src/enum';")!];
    const merged = mergeStatements([ours, []])!;
    expect(specifierKeys(merged).has('src/enum.js::Kept')).toBe(true);
  });

  it('handles diff3-style regions with a base section', () => {
    const source = [
      '<<<<<<< HEAD',
      "import { A } from 'src/enum';",
      '||||||| base',
      "import { A } from 'src/enum';",
      '=======',
      "import { A } from 'src/enum.js';",
      '>>>>>>> upstream/main',
    ].join('\n');
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.text).toContain("import { A } from 'src/enum.js';");
  });

  // Verbatim from the spike tree: e2e/src/specs/maintenance/server/database-backups.e2e-spec.ts.
  // This is the shape that actually occurs — a fork-added binding on a bare package specifier,
  // a fork-only import of a module upstream never mentions, and two modules upstream re-suffixed.
  it('merges a real zdiff3 region without losing fork bindings', () => {
    const source = [
      '<<<<<<< HEAD',
      "import { LoginResponseDto, ManualJobName, login } from '@immich/sdk';",
      "import { loginDto } from 'src/fixtures';",
      "import { errorDto } from 'src/responses';",
      "import { app, utils } from 'src/utils';",
      '||||||| 86ae0dd06c7',
      "import { LoginResponseDto, ManualJobName } from '@immich/sdk';",
      "import { errorDto } from 'src/responses';",
      "import { app, utils } from 'src/utils';",
      '=======',
      "import { LoginResponseDto, ManualJobName } from '@immich/sdk';",
      "import { errorDto } from 'src/responses.js';",
      "import { app, utils } from 'src/utils.js';",
      '>>>>>>> upstream/main',
      "import request from 'supertest';",
    ].join('\n');

    const result = resolveConflictedSource(source);

    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    // fork's added binding survives on the bare specifier, which is NOT suffixed
    expect(result.text).toContain(
      "import { LoginResponseDto, ManualJobName, login } from '@immich/sdk';",
    );
    // fork-only import upstream never had, now suffixed
    expect(result.text).toContain("import { loginDto } from 'src/fixtures.js';");
    // upstream's suffixing adopted on the shared modules
    expect(result.text).toContain("import { errorDto } from 'src/responses.js';");
    expect(result.text).toContain("import { app, utils } from 'src/utils.js';");
    // the shared tail zdiff3 left outside the region is untouched
    expect(result.text).toContain("import request from 'supertest';");
  });
});

describe('specifier-only fallback (zdiff3-truncated regions)', () => {
  it('resolves a truncated import tail that differs only by the .js suffix', () => {
    // The real shape found in the spike tree: zdiff3 hoisted the identical opening lines of a
    // multi-line named import out of the region, leaving only the closing `} from '...';` line,
    // which the structured path refuses because it does not start on a statement boundary.
    const source = conflict("} from 'src/dtos/foo.dto';", "} from 'src/dtos/foo.dto.js';");
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).toContain("} from 'src/dtos/foo.dto.js';");
    expect(result.text).not.toContain('<<<<<<<');
  });

  it('resolves a multi-line truncated region that differs only by specifier form', () => {
    const source = conflict(
      "} from 'src/foo';\nimport { X } from 'src/bar';",
      "} from 'src/foo.js';\nimport { X } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.refused).toBe(0);
    expect(result.resolved).toBe(1);
    expect(result.text).toContain("} from 'src/foo.js';");
    expect(result.text).toContain("import { X } from 'src/bar.js';");
  });

  it('REFUSES when one side has an added binding the other lacks (line count differs)', () => {
    const source = conflict(
      "} from 'src/foo';\n  Extra,\nimport { X } from 'src/bar';",
      "} from 'src/foo.js';\nimport { X } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
    expect(result.text).toContain('Extra,');
  });

  it('REFUSES when the sides differ in a non-specifier way on the same line', () => {
    const source = conflict(
      "} from 'src/foo';\nimport { A as B } from 'src/bar';",
      "} from 'src/foo.js';\nimport { A as C } from 'src/bar.js';",
    );
    const result = resolveConflictedSource(source);
    expect(result.resolved).toBe(0);
    expect(result.refused).toBe(1);
    expect(result.text).toContain('<<<<<<<');
  });

  it('normalizeLineSpecifiers leaves a bare package specifier unchanged', () => {
    expect(normalizeLineSpecifiers("import x from 'kysely';")).toBe("import x from 'kysely';");
    expect(normalizeLineSpecifiers("} from 'kysely';")).toBe("} from 'kysely';");
  });
});
