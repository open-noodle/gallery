import { normalizeModule } from './import-merge';

const FROM_CLAUSE = /^(\s*(?:import|export)\b[^;]*?\bfrom\s*)(['"])([^'"]+)\2/gm;
const SIDE_EFFECT = /^(\s*import\s*)(['"])([^'"]+)\2/gm;

export function rewriteModuleSpecifiers(source: string): string {
  return source
    .replace(FROM_CLAUSE, (_m, head: string, quote: string, module: string) =>
      `${head}${quote}${normalizeModule(module)}${quote}`)
    .replace(SIDE_EFFECT, (_m, head: string, quote: string, module: string) =>
      `${head}${quote}${normalizeModule(module)}${quote}`);
}
