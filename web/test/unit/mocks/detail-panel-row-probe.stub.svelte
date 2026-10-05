<script lang="ts">
  // #734: stands in for DetailPanelDescription/Rating/Date/Location/Tags in detail-panel.spec.ts.
  // Echoes the `isOwner`/`canEdit` props it receives as data attributes so tests can assert which
  // value DetailPanel actually threaded down to each row, without depending on each real row
  // component's own internal rendering.
  const props = $props();
</script>

<div
  data-testid="detail-panel-row-probe"
  data-is-owner={String(!!props.isOwner)}
  data-can-edit={String(!!props.canEdit)}
></div>
