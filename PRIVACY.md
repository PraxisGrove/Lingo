# Lingo Privacy Policy

Last updated: 2026-07-12

Lingo is a browser extension for bilingual webpage translation. This policy
describes the Community extension in this repository. It must be reviewed and
updated before a public release or before data handling changes.

## Current Data Handling

When a reader starts a translation session, Lingo sends selected webpage text
from the background worker directly to the translation service configured by
the reader. For providers that support it, each request can also include the
page title and up to two adjacent paragraph excerpts, each limited to 600
characters, to improve translation quality. Lingo does not send the full URL,
the full webpage, or protected content as translation context.

Lingo does not operate an account system and does not collect telemetry.
Settings, service profiles, credentials, and the translation cache remain in
the browser profile.

## Planned Translation Data Flow

Credentials remain in local extension storage and are not exposed to webpages
or content scripts. Lingo will not silently send content to a different service.

Password, payment, editor, and `translate="no"` regions are outside normal
webpage translation. Translation cache entries will remain local and will not
store full webpage URLs.

## Collection and Sharing

Lingo does not collect, sell, or share browsing history, webpage content,
translation content, credentials, or usage analytics with Lingo. The selected
text and limited context described above are shared only with the reader's
configured translation service. Any future crash reporting or product analytics
will require explicit opt-in and a policy update.

## Data Control

Readers can clear extension settings through browser extension controls and can
clear the local translation cache from Lingo settings.

## Contact

Until a public support address is established, report privacy or security
concerns through the private reporting channel described in SECURITY.md.
