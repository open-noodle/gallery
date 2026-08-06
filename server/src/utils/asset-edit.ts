import { AssetEditAction, AssetEditActionItem, MirrorParameters } from 'src/dtos/editing.dto';

const editKey = (edit: AssetEditActionItem): string =>
  edit.action === AssetEditAction.Mirror ? `mirror:${(edit.parameters as MirrorParameters).axis}` : edit.action;

/** Merge incoming edits into existing: replace any edit with the same key (mirror keyed by axis); crop stays first. */
export const mergeEdits = (existing: AssetEditActionItem[], incoming: AssetEditActionItem[]): AssetEditActionItem[] => {
  const incomingKeys = new Set(incoming.map((edit) => editKey(edit)));
  const merged = [...existing.filter((e) => !incomingKeys.has(editKey(e))), ...incoming];
  const crop = merged.find((e) => e.action === AssetEditAction.Crop);
  return crop ? [crop, ...merged.filter((e) => e.action !== AssetEditAction.Crop)] : merged;
};
