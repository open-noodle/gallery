import { type KnownDirectoryImports, normalizeModule } from './import-merge';

const FROM_CLAUSE =
  /^(\s*(?:import|export)\b[^;]*?\bfrom\s*)(['"])([^'"]+)\2/gm;
const SIDE_EFFECT = /^(\s*import\s*)(['"])([^'"]+)\2/gm;

/**
 * `knownDirectories` is optional and forwarded verbatim to `normalizeModule` — omit it to keep the
 * old, filesystem-free behaviour (unconditional `.js` suffix). A caller sweeping a real tree should
 * build one per package root with `collectDirectoryImportSpecifiers` and pass the set matching the
 * file currently being rewritten (server/ and e2e/ each need their own — see import-merge.ts).
 */
export function rewriteModuleSpecifiers(
  source: string,
  knownDirectories?: KnownDirectoryImports,
): string {
  return source
    .replace(
      FROM_CLAUSE,
      (_m, head: string, quote: string, module: string) =>
        `${head}${quote}${normalizeModule(module, knownDirectories)}${quote}`,
    )
    .replace(
      SIDE_EFFECT,
      (_m, head: string, quote: string, module: string) =>
        `${head}${quote}${normalizeModule(module, knownDirectories)}${quote}`,
    );
}
