# Extension Permissions

## `storage`

Lingo stores versioned preferences in the browser profile. Later stages will
also store service configuration references, site rules, and local cache
metadata. Credentials will be isolated in local storage for background-worker
access and excluded from ordinary exports and logs.

## `<all_urls>`

Lingo needs host access to identify translatable content, present translations,
continue sessions on dynamic webpages, and apply explicit site and source-language
translation policies. Restricting access to the active tab would prevent those
core behaviors.

Host access is not permission to collect browsing history. In phase 0 the
content script performs only minimal initialization and sends no page content.
When translation is implemented, content will be sent only after an applicable
user action or translation policy and only to the service the reader selected.

Lingo does not execute remote code. Future community site-rule updates must be
signed, schema-validated declarative data.
