# Extension Permissions

## `storage`

Lingo stores versioned preferences, service configuration references, site
rules, and local cache metadata in the browser profile. Credentials are
isolated in local storage for background-worker access and excluded from
ordinary exports, diagnostics, and logs.

## `contextMenus`

Lingo adds page-level menu commands to translate the current page, translate
all recognized content, or restore the original page. It does not add selection
or link menus and does not read menu activity outside these explicit commands.

## `<all_urls>`

Lingo needs host access to identify translatable content, present translations,
continue sessions on dynamic webpages, and apply explicit site and source-language
translation policies. Restricting access to the active tab would prevent those
core behaviors.

Host access is not permission to collect browsing history. When no translation
session is active, the content script performs only minimal initialization and
sends no page content. Content is sent only after an applicable user action or
translation policy and only to the service the reader selected.

Lingo does not execute remote code. Community site-rule updates are signed,
schema-validated declarative data.
