export const agentMcpPromptPlaceholderMap = {
  '00000000-0000-4000-8000-000000000001': '<exact-asset-id-from-readAssetMetadata>',
  '00000000-0000-4000-8000-000000000002': '<another-exact-asset-id-from-readAssetMetadata>',
  '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
  '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
  '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000041': '<another-personIds value from resolveAssetSearchFilters>',
  '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
  '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
  '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
  'asset-source:search:00000000-0000-4000-8000-000000000333': '<sourceRef from searchAssets>',
} as const;

export const renderAgentMcpPromptPlaceholders = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return agentMcpPromptPlaceholderMap[value as keyof typeof agentMcpPromptPlaceholderMap] ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => renderAgentMcpPromptPlaceholders(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      renderAgentMcpPromptPlaceholders(entry),
    ]),
  );
};
