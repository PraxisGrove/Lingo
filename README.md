# Browser Extension Template

A WXT, React, and TypeScript starter for serious browser extension products.

It includes a popup, a thin options page, a background service worker, a content
script, typed messaging, typed storage, scoped logging, GitHub Actions, Vitest,
and Biome.

## Project Shape

```txt
entrypoints/
  background.ts          # Background service worker
  content.ts             # Minimal-permission content script example
  options/               # Thin settings page
  popup/                 # Popup UI
lib/
  logger/                # Scoped local logging
  messaging/             # Typed runtime messages
  storage/               # Typed settings storage
```

## Logging

Use `createLogger('scope')` from `lib/logger/logger.ts` instead of direct
`console.*` calls. Logs are scoped, accept typed context objects, default to
`debug` in development, and default to `warn` in production builds.

This template intentionally does not ship remote log collection. Add a telemetry
or error-reporting provider only after the product has a clear privacy policy,
consent model, and data-retention plan.

## Permissions

The template defaults to minimal permissions. The content script only matches:

```ts
['https://example.com/*']
```

Change `entrypoints/content.ts` when your extension needs a real host. Avoid
`<all_urls>` or broad `http://*/*` / `https://*/*` matches unless the product
really requires full-site access.

## Scripts

```bash
pnpm install
pnpm dev
pnpm compile
pnpm test
pnpm check
pnpm build
pnpm zip
```

Use `pnpm dev:firefox`, `pnpm build:firefox`, or `pnpm zip:firefox` when targeting Firefox.

## CI/CD

GitHub Actions runs `pnpm compile`, `pnpm test`, `pnpm check`, and `pnpm build`
on pushes to `main` and pull requests.

Pushing a tag like `v1.0.0` builds Chrome and Firefox zip packages and creates a
draft GitHub release. The workflow intentionally does not publish to Chrome Web
Store or Firefox Add-ons automatically; submit the generated packages manually
unless the product has a reviewed release process and store credentials in place.

## Before Shipping

- Update `name`, `description`, and `version` in `package.json` and
  `wxt.config.ts`.
- Replace the icons in `public/icon/`.
- Review content script matches and any future permissions.
- Run `pnpm compile`, `pnpm test`, `pnpm check`, and `pnpm build`.
- Use `pnpm zip` for Chrome/Edge and `pnpm zip:firefox` for Firefox.
