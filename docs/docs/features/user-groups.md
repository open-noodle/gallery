# User Groups

A User Group is a named, color-coded list of users. Build one once, then select all of its members with a single click every time you share an album or invite people to [Shared Spaces](shared-spaces.md).

## What Groups Do

- Click a group chip to select all its members at once when sharing an album or inviting to a space.
- Each group carries a color, so you can recognise it at a glance in the sharing modals.
- Groups are personal. You create and manage your own, and other users cannot see them.
- Groups are a selection shortcut. They grant no access to anything on their own.

## Creating a Group

1. Go to **User Settings** (click your avatar > Account Settings).
2. Expand the **User Groups** section.
3. Click **Create group**.
4. Enter a name (e.g., "Family", "Close Friends", "Work Team").
5. Choose a color from the palette.
6. Select members from the user list. The search bar filters it.
7. Click **Create**.

## Managing Groups

From the **User Groups** section in User Settings:

- The pencil icon on a group opens it for editing: name, color, and members.
- The trash icon deletes it, after a confirmation dialog. Deleting a group does not affect any albums or spaces already shared with those users.

## Using Groups When Sharing

Groups appear as colored chips at the top of the user selection modal in two places:

- Sharing an album: open the album, click **Share**, and the chips sit above the user list.
- Inviting to a Space: open the space, go to the Members panel, click **Add member**, and the chips sit above the user list.

### How it works

1. A group chip only appears if the group has at least one eligible member. Members already in the album or space are excluded.
2. Click a group chip to select all eligible members. The chip fills with the group's color.
3. Click the chip again to deselect all members from that group.
4. After clicking a chip you can still select or deselect individual users by hand.
5. If a user belongs to several active groups, deselecting one group keeps them selected as long as another active group includes them.
6. The number next to each chip shows how many eligible members will be added.

## Tips

- Groups work best for sharing patterns you repeat: family branches, friend circles, project teams.
- Groups can overlap. "Parents" and "Extended Family" can share some members.
- A group with no eligible members for a particular share is hidden automatically.
- There is no limit on the number of groups or members per group.

## Technical Implementation

### Database Schema

User Groups adds two tables:

```
┌───────────────────────┐         ┌──────────┐
│     user_group        │         │   user   │
├───────────────────────┤         └────┬─────┘
│ id (UUID PK)          │              │
│ name (text)           │◄─createdById─┘
│ color (varchar?)      │
│ origin (varchar)      │   ┌──────────────────────┐
│ createdAt, updatedAt  │   │  user_group_member   │
└───────────┬───────────┘   ├──────────────────────┤
            │               │ groupId (FK) ◄───────┘
            └──────────────►│ userId  (FK) ────────► user
                            │ addedAt               │
                            └──────────────────────┘
                            PK: (groupId, userId)
```

The `origin` column tracks how the group was created (`manual` for user-created, `oidc` for future OIDC provider sync).

### Architecture

- `user-group.controller.ts` exposes 6 REST endpoints under `/user-groups` for CRUD and member management.
- `user-group.service.ts` enforces ownership, so only the creator can modify a group. Member replacement is atomic: `setMembers` deletes all existing members and inserts the new set in a single transaction.
- `user-group.repository.ts` holds the Kysely queries, joining the `user` table to resolve member profiles (name, email, avatar). Soft-deleted users are filtered out automatically.

### Integration Points

Groups live entirely in the UI and have no server-side effect on permissions. The web frontend loads your groups in the album share modal and the space member invite modal, and renders them as colored chips. Clicking a chip runs client-side logic that selects all eligible members, excluding users already in the album or space. The server never sees a group ID during sharing. The API calls carry individual user IDs.
