# Contributing to Lingo

Thank you for contributing to Lingo.

## Before You Start

Open an issue before making a substantial product, permission, privacy,
storage, provider, or architecture change. Keep browser entrypoints focused on
wiring and put shared behavior behind interfaces in `lib/`.

By submitting a contribution, you agree to the terms in [CLA.md](./CLA.md).
The project must establish a signed CLA process before accepting external code.

## Development

Use the Node version pinned in `.nvmrc` and pnpm for package operations.
Before opening a pull request, run:

```bash
pnpm browser:install # once per Playwright version
pnpm compile
pnpm test
pnpm test:browser
pnpm check
pnpm build
pnpm build:firefox
pnpm test:extension
```

`pnpm test:extension` loads the built extension into a real Chromium. It runs on
macOS in CI because its sidebar layout assertions encode that platform's font
metrics; the browser suite still runs on Linux. Extension actions use
`EXTENSION_ACTION_TIMEOUT` from `tests/extension/timeouts.ts` so a cold service
worker is not mistaken for a broken panel.

Add tests next to the code they cover. Test behavior through public module
interfaces and avoid direct `console.*` calls; use the scoped logger.

The type-checking contract lives in `tsconfig.json`, which extends the file WXT
generates. WXT 0.21 turns on `noUncheckedIndexedAccess` in that generated file;
the root configuration pins it back off because adopting it is a separate change
across roughly thirty source files, not a dependency bump. Remove the override
together with that work.

## Landing On Main

Work directly on `main`; pull requests are not required. `main` does require the
CI checks and enforces that rule for administrators, and GitHub can only run
checks once a ref exists, so a plain `git push` to `main` is rejected until the
exact commit has passed. Land a commit with:

```bash
pnpm ship
```

`scripts/ship.sh` pushes the current `main` commit to a throwaway `verify/<sha>`
ref, waits for the CI run for that commit, then pushes the same commit to `main`
and deletes the verify ref. A failing run keeps the verify ref and stops.

## Pull Requests

Use a concise imperative title. Describe the behavior changed, list validation
commands, and include screenshots for popup or settings UI changes. Explicitly
call out changes to permissions, host matches, the manifest, storage, privacy,
or release workflows.
