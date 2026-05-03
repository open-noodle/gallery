type StoredTypedSearchNames = {
  personNames: Array<[string, string]>;
  tagNames: Array<[string, string]>;
};

const prefix = 'typed-search:names:';

function emptyNames() {
  return {
    personNames: new Map<string, string>(),
    tagNames: new Map<string, string>(),
  };
}

export function storeTypedSearchNames(
  destination: string,
  names: { personNames: Map<string, string>; tagNames: Map<string, string> },
) {
  if (typeof sessionStorage === 'undefined') {
    return;
  }

  const payload: StoredTypedSearchNames = {
    personNames: [...names.personNames.entries()],
    tagNames: [...names.tagNames.entries()],
  };

  sessionStorage.setItem(`${prefix}${destination}`, JSON.stringify(payload));
}

export function consumeTypedSearchNames(destination: string) {
  if (typeof sessionStorage === 'undefined') {
    return emptyNames();
  }

  const key = `${prefix}${destination}`;
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) {
    return emptyNames();
  }

  try {
    const parsed = JSON.parse(raw) as StoredTypedSearchNames;
    return {
      personNames: new Map(parsed.personNames ?? []),
      tagNames: new Map(parsed.tagNames ?? []),
    };
  } catch {
    return emptyNames();
  }
}
