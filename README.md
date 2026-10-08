# Lingo

Lingo is an open-source bilingual webpage translation extension. It keeps the
original text in context and sends content only to the translation service the
reader explicitly configures.

The repository includes a working translation workflow built with WXT, React,
and TypeScript. Webpage content scripts identify paragraphs and present
translations; the background worker handles configured services, credentials,
retries, and local caching.

## Current Capabilities

- OpenAI-compatible, DeepL, Google Cloud Translation, and Azure Translator
  service profiles, connection tests, and explicitly configured fallback chains.
- Viewport-based translation, full-page translation, dynamically added
  and updated paragraphs, partial-failure retries, and original-page restoration.
- Saved source-language selection is applied in the background to translation
  requests and cache keys. Stopping a session cancels queued work and aborts
  pending requests; translation can be started again without reloading the page.
- Bilingual and translation-only display, with links, emphasis, headings,
  lists, captions, and tables preserved.
- Site and source-language automatic translation policies, local rule
  import/export, terminology, and translation instructions.
- Popup controls, settings, keyboard shortcuts, context menus, an optional
  floating control, and localized interfaces.
- Local translation cache, cache controls, and redacted diagnostic exports.

Paragraphs containing protected or hidden content are kept intact and excluded
from translation requests, including inline code and `translate="no"` spans.
Queued paragraphs are checked again before they are sent.

This is still a development version. Site selector integration, community rule
distribution, production SPA recovery, and full extension acceptance testing
remain work for the implementation roadmap. Automated provider tests use
fixtures; they do not verify live accounts or billing.

## Try It

1. Run `pnpm install` and `pnpm dev`, or build with `pnpm build` and load
   `.output/chrome-mv3` as an unpacked extension in Chrome or Edge.
2. Open Lingo settings, select a target language, and configure a translation
   service with your own credentials. Test the connection and save the profile.
3. Open an ordinary webpage and use the popup or `Alt+Shift+L` to translate.
   Use the popup to change display mode or restore the original page.

## Product Design

- [Domain language](./CONTEXT.md)
- [Product plan](./docs/product-plan.md)
- [Technical architecture](./docs/technical-architecture.md)
- [Implementation plan](./docs/implementation-plan.md)
- [Architecture decisions](./docs/adr/)

## Development

Prerequisites are Node.js 22.13 or newer and pnpm 11.22.0 (pinned in
`package.json`).

```bash
pnpm install
pnpm dev
pnpm compile
pnpm test
pnpm browser:install
pnpm test:browser
pnpm check
pnpm build
```

Use `pnpm dev:firefox`, `pnpm build:firefox`, or `pnpm zip:firefox` for
Firefox. Chrome and Edge use the default Chromium build.

## Privacy and Permissions

Lingo requests access to webpages so it can identify and present translated
content. Translation requests go directly from the extension background worker
to the service selected by the reader. Lingo does not collect telemetry or
operate a translation proxy. Credentials and cached translations stay in the
local browser profile.

See the [privacy policy](./PRIVACY.md), [permission explanation](./docs/permissions.md),
and [security policy](./SECURITY.md) for the current guarantees and reporting
process.

## Contributing and License

See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting changes. Lingo is
licensed under the [GNU Affero General Public License v3.0](./LICENSE). External
contributions require agreement to the [CLA](./CLA.md). The CLA and other legal
texts require legal review before the first public release.
