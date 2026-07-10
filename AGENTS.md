# Repository Guidelines

## Project Structure & Module Organization

This is a WXT browser extension template using React and TypeScript.

- `entrypoints/background.ts` contains the background service worker.
- `entrypoints/content.ts` contains the minimal content script example.
- `entrypoints/popup/` contains the popup React UI.
- `entrypoints/options/` contains the thin options page.
- `lib/messaging/` contains typed runtime messaging helpers.
- `lib/storage/` contains the typed WXT storage wrapper and settings model.
- `lib/logger/` contains the scoped local logger.
- `public/icon/` contains extension icons.
- `.github/workflows/` contains CI and release packaging workflows.

Keep shared logic in `lib/`; keep browser entrypoint wiring in `entrypoints/`.

## Build, Test, and Development Commands

Use pnpm for all package operations.

- `pnpm install` installs dependencies and runs WXT preparation.
- `pnpm dev` starts WXT development for Chromium-based browsers.
- `pnpm dev:firefox` starts WXT development for Firefox.
- `pnpm compile` runs TypeScript type checking.
- `pnpm test` runs Vitest once.
- `pnpm check` runs Biome checks.
- `pnpm build` builds the Chrome MV3 extension.
- `pnpm zip` and `pnpm zip:firefox` create store-ready zip packages.

## Coding Style & Naming Conventions

Use TypeScript, React function components, and ES modules. Biome enforces formatting with two-space indentation and single quotes for JavaScript/TypeScript. Prefer explicit typed helpers for cross-entrypoint contracts, such as messages and storage models.

Use descriptive file names like `settings-model.ts`, `send-message.ts`, and `logger.test.ts`. Avoid direct `console.*` calls; use `createLogger('scope')` from `lib/logger/logger.ts`.

## Testing Guidelines

Vitest is the test framework. Place tests next to the code they cover using `*.test.ts`. Prefer testing pure model and helper logic, especially typed messaging, storage normalization, and logger behavior.

Run `pnpm test` before opening a PR. For changes that affect browser packaging or manifest output, also run `pnpm build`.

## Commit & Pull Request Guidelines

Existing commit messages use concise imperative summaries, for example `Add scoped extension logger` and `Use latest GitHub Actions majors`. Follow that style.

Pull requests should include a short description, validation commands run, and screenshots for popup or options UI changes. Call out any permission, host match, manifest, storage, or release workflow changes explicitly.

## Security & Configuration Tips

Keep default permissions minimal. Do not add broad host matches like `<all_urls>` unless the product requires them. This template does not include remote logging or telemetry by default; add those only with a clear privacy policy and consent model.
