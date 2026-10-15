<script lang="ts">
  import { systemConfigManager } from '$lib/managers/system-config-manager.svelte';
  import { handleError } from '$lib/utils/handle-error';
  import {
    FamilyAccessLevel,
    getAllAccess,
    searchUsersAdmin,
    setAccess,
    type FamilyAccessGrantResponseDto,
    type UserAdminResponseDto,
  } from '@immich/sdk';
  import { Table, TableBody, TableCell, TableHeader, TableHeading, TableRow } from '@immich/ui';
  import { DateTime } from 'luxon';
  import { t } from 'svelte-i18n';

  // Gallery-fork: family relationships (D2), layer 2 — the per-user access grant table.
  //
  // A11: "Inherits default" is rendered as its own state, kept separate from any explicit
  // value — never synthesized from `familyTree.defaultAccess`. Every account on the instance
  // gets a row here; only some of them have a row in `getAllAccess()` (an explicit grant). The
  // ones that don't are shown with `family-admin-inherited-badge`, and their select reflects the
  // CURRENT default for display only — it is never written anywhere, so an explicit `none` (a
  // real override, E19) never gets confused with an inherited `none` that merely tracks whatever
  // the default happens to be today, even though both resolve to the same effective access.
  //
  // E66: changing the instance default never touches a row here — this component only ever
  // calls `setAccess` in response to an explicit admin action on a specific row.
  // E67: revoking access is just another call to `setAccess` (with level `none`) — a grant
  // change, never a delete, and it never touches anything family-relationship-shaped.
  const config = $derived(systemConfigManager.value);
  const enabled = $derived(config.familyTree.enabled);

  let users: UserAdminResponseDto[] = $state([]);
  let grants: FamilyAccessGrantResponseDto[] = $state([]);

  const grantByUserId = $derived(new Map(grants.map((grant) => [grant.userId, grant])));
  const usernameById = $derived(new Map(users.map((user) => [user.id, user.name])));
  const sortedUsers = $derived([...users].sort((a, b) => a.name.localeCompare(b.name)));

  const formatGrantedAt = (iso: string) => DateTime.fromISO(iso).toUTC().setLocale('en').toFormat('d LLL');

  const load = async () => {
    try {
      const [allUsers, allGrants] = await Promise.all([searchUsersAdmin({}), getAllAccess()]);
      users = allUsers;
      grants = allGrants;
    } catch (error) {
      handleError(error, $t('admin.family_admin_access_load_error'));
    }
  };

  $effect(() => {
    if (enabled) {
      void load();
    }
  });

  const handleChange = async (userId: string, level: FamilyAccessLevel) => {
    try {
      const updated = await setAccess({ userId, familyAccessUpdateDto: { level } });
      grants = [...grants.filter((grant) => grant.userId !== userId), updated];
    } catch (error) {
      handleError(error, $t('admin.family_admin_access_save_error'));
    }
  };
</script>

{#if enabled}
  <div>
    <h3 class="text-sm font-medium text-primary">{$t('admin.family_admin_access_table_title')}</h3>

    <Table class="mt-2" striped spacing="small" size="small">
      <TableHeader>
        <TableHeading>{$t('admin.family_admin_access_table_header_user')}</TableHeading>
        <TableHeading>{$t('admin.family_admin_access_table_header_access')}</TableHeading>
        <TableHeading>{$t('admin.family_admin_access_table_header_granted_by')}</TableHeading>
      </TableHeader>

      <TableBody>
        {#each sortedUsers as user (user.id)}
          {@const grant = grantByUserId.get(user.id)}
          {@const isExplicit = !!grant}
          {@const displayLevel = grant?.level ?? config.familyTree.defaultAccess}
          <TableRow data-testid="family-admin-access-row">
            <TableCell>{user.name}</TableCell>
            <TableCell>
              <div class="flex items-center gap-2">
                {#if !isExplicit}
                  <span
                    data-testid="family-admin-inherited-badge"
                    class="text-sm text-immich-fg/60 italic dark:text-immich-dark-fg/60"
                  >
                    {$t('admin.family_admin_inherits_default')}
                  </span>
                {/if}
                <select
                  class="immich-form-input py-1"
                  aria-label={$t('admin.family_admin_access_select_label')}
                  value={displayLevel}
                  onchange={(event) =>
                    handleChange(user.id, (event.currentTarget as HTMLSelectElement).value as FamilyAccessLevel)}
                >
                  <option value={FamilyAccessLevel.None}>{$t('admin.family_admin_access_level_none')}</option>
                  <option value={FamilyAccessLevel.View}>{$t('admin.family_admin_access_level_view')}</option>
                  <option value={FamilyAccessLevel.Contribute}
                    >{$t('admin.family_admin_access_level_contribute')}</option
                  >
                </select>
              </div>
            </TableCell>
            <TableCell>
              {#if grant?.grantedById}
                {usernameById.get(grant.grantedById) ?? grant.grantedById} · {formatGrantedAt(grant.grantedAt)}
              {:else}
                —
              {/if}
            </TableCell>
          </TableRow>
        {/each}
      </TableBody>
    </Table>
  </div>
{/if}
