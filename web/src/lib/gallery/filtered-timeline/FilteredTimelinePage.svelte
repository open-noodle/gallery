<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/UserPageLayout.svelte';
  import type { ComponentProps } from 'svelte';
  import FilteredTimeline from './FilteredTimeline.svelte';

  type Props = ComponentProps<typeof FilteredTimeline> & Omit<ComponentProps<typeof UserPageLayout>, 'children'>;

  // Stands in for the route's `<UserPageLayout>`, so the upstream `<Timeline>` keeps its place.
  let {
    hideNavbar,
    title,
    description,
    scrollbar,
    use,
    actions,
    leading,
    descriptionTrailing,
    sidebar,
    buttons,
    children,
    ...timeline
  }: Props = $props();
</script>

<UserPageLayout
  {hideNavbar}
  {title}
  {description}
  {scrollbar}
  {use}
  {actions}
  {leading}
  {descriptionTrailing}
  {sidebar}
  {buttons}
>
  <FilteredTimeline {...timeline}>
    {@render children()}
  </FilteredTimeline>
</UserPageLayout>
