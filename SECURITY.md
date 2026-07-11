# Security Policy

## Supported Versions

Lingo is in pre-release development. Security fixes are made on the current
`main` branch; no released version is supported yet.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability. Submit a
[private vulnerability report](https://github.com/PraxisGrove/Lingo/security/advisories/new)
to the repository maintainers and include reproduction steps, affected versions,
impact, and any suggested mitigation.

Do not include real service credentials, sensitive webpage content, or personal
data in a report. Maintainers will acknowledge the report through the private
advisory, coordinate remediation there, and publish disclosure only after a fix
is available or an agreed disclosure date is reached.

Security-sensitive areas include credential isolation, webpage/content-script
boundaries, provider endpoints, remote rule signatures, extension permissions,
message validation, and diagnostic redaction.
