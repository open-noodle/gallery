# User Settings

Gallery gives each user the ability to manage their own settings. This includes being able to update their profile, toggle certain feature, generate API keys, manage the logged in devices, a view of account usage statistics, and more.

<img src={require('./img/user-settings-3.webp').default} width="60%" title='User settings lists' />

You can access the [user settings](https://my.immich.app/user-settings) by clicking on the user icon on the top right corner of the screen and selecting the `Account Settings` option.

<img src={require('./img/user-settings-1.webp').default} width="33%" title='User settings location 1' />

<br/>

<img src={require('./img/user-settings-2.webp').default} width="33%" title='User settings location 2' />

---

## Sidebar

`App Settings` → `Sidebar` controls how much room the navigation sidebar takes on screen.

| Mode                    | Behaviour                                                                  |
| ----------------------- | -------------------------------------------------------------------------- |
| **Automatic** (default) | Expanded on wide screens (1279px and up), compact between 850px and 1279px |
| **Always expanded**     | Full-width sidebar with labels, whatever the window size                   |
| **Always compact**      | Icon-only rail, whatever the window size                                   |

In the compact rail, hovering or tabbing into the sidebar expands it over the page so you can read the labels, and it collapses again when you move away. The photo grid underneath keeps its position rather than reflowing, so nothing jumps while you are pointing at it. On touch devices, the menu button in the top bar opens the same expanded view.

Below 850px the sidebar is hidden entirely in every mode and opens as an overlay from the menu button — a rail costs width a phone cannot spare.

:::info Stored per browser
The choice is saved in the browser rather than on your account, so each device or browser you sign in from keeps its own setting.
:::

## Filter sections

Pages with a filter panel — Photos, Recently added, album detail, and Spaces — let you choose which filter sections it offers. Open the panel and use the cog beside the `Filters` heading to tick the sections you want; `Show all` brings back every one.

Hidden sections keep any filter you had already applied. When that happens a dot appears on the cog, and again beside the section's name in the menu, so an active filter you cannot see is still visible from the outside.

---

:::tip Reset Password
The admin can reset a user password through the [User Management](/administration/user-management.mdx) screen.
:::

:::tip Reset Admin Password
The admin password can be reset using a [Server Command](/administration/server-commands.md)
:::
