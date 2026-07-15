# Contributing to Lingo

Thank you for contributing to Lingo.

## Before You Start

Open an issue before making a substantial product, permission, privacy,
storage, provider, or architecture change. Keep browser entrypoints focused on
wiring and put shared behavior behind interfaces in `lib/`.

By submitting a contribution, you agree to the terms in [CLA.md](./CLA.md).
The project must establish a signed CLA process before accepting external code.

## Development

Use pnpm for package operations. Before opening a pull request, run:

```bash
pnpm browser:install # once per Playwright version
pnpm compile
pnpm test
pnpm test:browser
pnpm check
pnpm build
pnpm build:firefox
```

Add tests next to the code they cover. Test behavior through public module
interfaces and avoid direct `console.*` calls; use the scoped logger.

## Pull Requests

Use a concise imperative title. Describe the behavior changed, list validation
commands, and include screenshots for popup or settings UI changes. Explicitly
call out changes to permissions, host matches, the manifest, storage, privacy,
or release workflows.
