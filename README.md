# Lingo

Lingo is an open-source bilingual reading and translation extension. Read
webpages, translate selected text, and write across languages while choosing
your own translation service and keeping control of your data.

The repository includes a working translation workflow built with WXT, React,
and TypeScript. Webpage content scripts identify paragraphs and present
translations; the background worker handles configured services, credentials,
retries, and local caching.

The current release focuses on browser reading and everyday text interactions.
Document, subtitle, image, and additional platform support are later product
explorations; they are not prerequisites for this extension stage.

## Current Capabilities

- OpenAI-compatible, DeepL, Google Cloud Translation, and Azure Translator
  service profiles, connection tests, and explicitly configured fallback chains.
- Viewport-based translation, full-page translation, dynamically added
  and updated paragraphs, partial-failure retries, and original-page restoration.
- Completed batches appear while remaining requests are still running. Long
  pages are grouped by paragraph count and conservative character budgets.
  Oversized paragraphs are split and reassembled with inline formatting intact.
- Saved source-language selection is applied in the background to webpage
  requests and cache keys. Text tools have their own source-language control,
  which defaults to automatic detection. Stopping a session cancels queued work and aborts
  pending requests; translation can be started again without reloading the page.
- Bilingual and translation-only display, with links, emphasis, headings,
  lists, captions, and tables preserved.
- Site and source-language automatic translation policies, local rule
  import/export, terminology, and translation instructions.
- Reading-area rules for ten representative site layouts, with user-defined
  main, interface, and exclusion selectors applied to manual and automatic
  translation. Layout rules do not automatically enable new sites.
- Popup controls, settings, keyboard shortcuts, context menus, an optional
  floating control, and localized interfaces.
- Local translation cache, cache controls, and redacted diagnostic exports.
- Nested open Shadow DOM, dynamic components, inherited exclusions, and
  translation styles scoped to each accessible root.
- Worker-wide concurrency and request-start limits, and shared equivalent
  in-flight batches with independent cancellation for each reader.
- Selection translation, explicitly triggered hovered-paragraph translation,
  a page-side translation panel, and an independent text translation tab.
- Explicit plain-text input translation with preview, confirmed replacement,
  undo, and protection against overwriting intervening user edits.
- Optional signed community-rule subscriptions with an explicitly configured
  HTTPS address and trusted publisher key; failed updates retain verified rules.

Paragraphs containing protected or hidden content are kept intact and excluded
from translation requests. Visible inline code is represented by opaque markers,
so surrounding prose can be translated without sending the code. Code blocks
and `translate="no"` spans remain excluded. Queued paragraphs are checked again
before they are sent; invalid marker responses are rejected.

This is still a development version. History API navigation is handled through
browser navigation events for the corresponding tab/frame. Installed Chromium
extension tests cover popup controls, rules, iframe translation, streaming,
cancellation, SPA navigation, text interactions, Shadow DOM, and worker restart
against a local HTTP provider.
Chromium and Firefox also run the same local page-layout fixtures.

The fixtures are representative layouts, not a guarantee that every live page
on those sites is supported. Real provider account validation, wider live-site
acceptance, and Firefox extension installation acceptance remain release work.
Closed shadow roots and rich-text editors are not supported. There is currently
no official rule subscription endpoint or bundled no-key translation service.
Local provider contracts do not verify translation quality, account limits, or billing.

## Try It

1. Run `pnpm install` and `pnpm dev`, or build with `pnpm build` and load
   `.output/chrome-mv3` as an unpacked extension in Chrome or Edge.
2. Open Lingo settings, select a target language, and configure a translation
   service with your own credentials. Test the connection and save the profile.
3. Open an ordinary webpage and use the popup or `Alt+Shift+L` to translate.
   Use the popup to change display mode or restore the original page.
4. Select webpage text and click the translation button, or use the shortcuts
   below. Open the independent text window from the popup or settings.

| Shortcut | Action |
| --- | --- |
| `Alt+Shift+L` | Toggle page translation (browser command) |
| `Alt+Shift+S` | Translate selected ordinary webpage text |
| `Alt+Shift+H` | Translate the paragraph under the pointer |
| `Alt+Shift+I` | Preview translation of the focused plain-text field |
| `Alt+Shift+T` | Open the page-side text translation panel |
| `Alt+Shift+U` | Undo the last input replacement, if the field has not changed |

Text shortcuts require focus in the webpage. Selection and input actions are
also available in the context menu, including inside frames. Password, payment,
read-only, and rich-text fields are excluded. The selection button can be turned
off in settings. Changing the current page target language or service restarts
that page session while preserving its scope and display mode. Rule publishers can follow [the subscription guide](./docs/rule-subscriptions.md).

## Brand Assets

The Dual Fold identity includes a vector symbol, outlined wordmark, light/dark
logos, transparent exports, and an optically adjusted toolbar icon. See the
[brand guide](./docs/brand/README.md), or run `pnpm brand:preview`.

Regenerate icons and exports from their SVG masters with `pnpm icons`.

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
pnpm test:extension
```

Use `pnpm dev:firefox`, `pnpm build:firefox`, or `pnpm zip:firefox` for
Firefox. Chrome and Edge use the default Chromium build.

Run `pnpm build` before `pnpm test:extension`. The installed-extension suite
uses a temporary Chromium profile and a local test service; it never accesses
personal browser profiles or sends content to a paid translation service.

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
