# Lingo Privacy Policy

Last updated: 2026-07-12

Lingo is a browser extension for bilingual webpage translation. This policy
describes the Community extension in this repository. It must be reviewed and
updated before a public release or before data handling changes.

## Current Phase

The phase 0 extension does not send webpage content to a translation service,
does not operate an account system, and does not collect telemetry. Settings and
limited diagnostic logs remain in the browser profile.

## Planned Translation Data Flow

When translation is implemented and the reader starts a translation session,
selected webpage text will be sent from the extension background worker directly
to the translation service configured by the reader. Credentials will remain in
local extension storage and will not be exposed to webpages or content scripts.
Lingo will not silently send content to a different service.

Password, payment, editor, and `translate="no"` regions are outside normal
webpage translation. Translation cache entries will remain local and will not
store full webpage URLs.

## Collection and Sharing

Lingo does not currently collect, sell, or share browsing history, webpage
content, translation content, credentials, or usage analytics. Any future crash
reporting or product analytics will require explicit opt-in and a policy update.

## Data Control

Readers can clear extension settings through browser extension controls. Future
versions that add translation caches or service profiles must provide controls
to inspect or delete those local records.

## Contact

Until a public support address is established, report privacy or security
concerns through the private reporting channel described in SECURITY.md.
