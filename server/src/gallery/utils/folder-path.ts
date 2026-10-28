import { trim } from 'lodash-es';
import type { ExpressionBuilder } from 'kysely';
import { DB } from 'src/schema/index.js';

const escapeLikePattern = (value: string) => value.replaceAll(/[\\%_]/g, String.raw`\$&`);

/**
Assets directly inside a folder of the folder view. Upstream (immich-32612) anchors the match at
an absolute path (`/dir/`); Gallery also stores S3 originals under relative keys (`upload/...`,
see `isDiskPath`), which the web tree sends back as the same slash-less path, so the relative
form (`dir/`) is anchored too. Each arm only matches its own kind of path.
*/
export const folderPathMatch = (eb: ExpressionBuilder<DB, 'asset'>, partialPath: string) => {
  const directory = trim(partialPath, '/');
  const prefixes = directory ? [`/${directory}/`, `${directory}/`] : ['/'];
  return eb.or(
    prefixes.map((prefix) => {
      const escaped = escapeLikePattern(prefix);
      return eb.and([
        eb('asset.originalPath', 'like', `${escaped}%`),
        eb('asset.originalPath', 'not like', `${escaped}%/%`),
      ]);
    }),
  );
};
