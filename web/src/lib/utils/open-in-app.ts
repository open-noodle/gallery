const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ROUTES: { regex: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  // Sub-routes BEFORE parents — important for /spaces/:id/photos/:assetId vs /spaces/:id
  { regex: new RegExp(`^/spaces/${UUID}/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/albums/${UUID}/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/photos/(${UUID})$`), build: (m) => `immich://asset?id=${m[1]}` },
  { regex: new RegExp(`^/albums/(${UUID})$`), build: (m) => `immich://album?id=${m[1]}` },
  { regex: new RegExp(`^/people/(${UUID})$`), build: (m) => `immich://people?id=${m[1]}` },
  { regex: new RegExp(`^/memory/(${UUID})$`), build: (m) => `immich://memory?id=${m[1]}` },
  { regex: new RegExp(`^/spaces/(${UUID})$`), build: (m) => `immich://space?id=${m[1]}` },
  { regex: /^\/memory$/, build: () => `immich://memory` },
];

export const pathToDeepLink = (pathname: string): string | null => {
  for (const { regex, build } of ROUTES) {
    const match = pathname.match(regex);
    if (match) {
      return build(match);
    }
  }
  return null;
};
