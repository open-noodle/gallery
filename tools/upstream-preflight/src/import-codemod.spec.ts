import { describe, expect, it } from 'vitest';
import { rewriteModuleSpecifiers } from './import-codemod';

describe('rewriteModuleSpecifiers', () => {
  it('suffixes alias and relative specifiers', () => {
    expect(rewriteModuleSpecifiers("import { A } from 'src/enum';")).toBe(
      "import { A } from 'src/enum.js';",
    );
    expect(rewriteModuleSpecifiers("export { B } from './local';")).toBe(
      "export { B } from './local.js';",
    );
  });

  it('leaves bare package specifiers alone', () => {
    const source = "import { Kysely } from 'kysely';\nimport { readdir } from 'node:fs/promises';";
    expect(rewriteModuleSpecifiers(source)).toBe(source);
  });

  it('handles multi-line named blocks', () => {
    const source = "import {\n  A,\n  B,\n} from 'src/enum';";
    expect(rewriteModuleSpecifiers(source)).toBe("import {\n  A,\n  B,\n} from 'src/enum.js';");
  });

  it('does not touch string literals that merely look like paths', () => {
    const source = "const p = 'src/enum';";
    expect(rewriteModuleSpecifiers(source)).toBe(source);
  });

  it('rewrites side-effect imports', () => {
    expect(rewriteModuleSpecifiers("import 'src/polyfill';")).toBe("import 'src/polyfill.js';");
  });
});
