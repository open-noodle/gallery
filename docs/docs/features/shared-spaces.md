# Shared Spaces

Shared Spaces are virtual libraries where multiple users can contribute, browse, and view photos together. Unlike [Partner Sharing](partner-sharing.md), which shares your entire library one-way, Shared Spaces let you create focused collaborative areas with fine-grained role-based access.

## Key Features

- **Reference-based sharing** — Photos are linked into a space, not duplicated. Zero additional storage cost.
- **Role-based access** — Three roles: Owner, Editor, and Viewer with different permissions.
- **Multiple spaces** — Create as many spaces as you need (e.g., "Family", "Friends", "Vacation 2025").
- **Works alongside existing sharing** — Partner sharing, album sharing, and shared links continue to work as before.

## Roles and Permissions

| Permission               | Owner | Editor | Viewer |
| ------------------------ | ----- | ------ | ------ |
| View assets in space     | Yes   | Yes    | Yes    |
| Add own assets to space  | Yes   | Yes    | No     |
| Remove assets from space | Yes   | Yes    | No     |
| Invite/remove members    | Yes   | No     | No     |
| Change member roles      | Yes   | No     | No     |
| Delete the space         | Yes   | No     | No     |
| Leave the space          | No    | Yes    | Yes    |

## Creating a Space

### Web

1. Click **Spaces** in the left sidebar.
2. Click the **Create Space** button.
3. Enter a name and optional description.
4. You are automatically added as the Owner.

### Mobile

1. Go to the **Library** tab.
2. Tap **Spaces**.
3. Tap the **+** button.
4. Enter a name and tap Create.

## Adding Members

From the space detail page, the Owner can invite other users:

1. Open the space.
2. Go to the Members section.
3. Add users by selecting them from the user list.
4. Choose a role: **Editor** (can add/remove photos) or **Viewer** (can only browse).

## Adding Photos to a Space

Editors and Owners can link photos from their personal library into a shared space:

1. Open the space.
2. Use the **Add Photos** action.
3. Select photos from your library.

Photos are linked by reference — they remain in your personal library and appear in the space for all members. Removing a photo from a space does not delete it from your library.

## Differences from Partner Sharing

| Feature         | Partner Sharing    | Shared Spaces              |
| --------------- | ------------------ | -------------------------- |
| What is shared  | Entire library     | Specific photos you choose |
| Direction       | One-way            | Multi-directional          |
| Access control  | All-or-nothing     | Owner/Editor/Viewer roles  |
| Multiple groups | No                 | Yes — unlimited spaces     |
| Storage cost    | None (same assets) | None (reference-based)     |

## API

Shared Spaces are accessible via the REST API under the `/shared-spaces` endpoint group.
