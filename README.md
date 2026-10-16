# Lingo

Lingo is an open-source webpage and text translation extension. Translate pages,
selected text, and input fields with your own service. Settings and cached
translations stay in your browser profile.

The repository includes a working translation workflow built with WXT, React,
and TypeScript. Webpage content scripts identify paragraphs and present
translations; the background worker handles configured services, credentials,
retries, and local caching.

The current release focuses on browser reading and everyday text interactions.
Document, subtitle, image, and additional platform support are later product
explorations; they are not prerequisites for this extension stage.

## Current Capabilities

- Optional vocabulary highlighting for English pages: rare words above the
  reader's chosen vocabulary size are underlined without changing the page,
  glossed on hover through the active service, and can be marked known or
  saved to a wordbook exported as Anki-ready TSV. Word frequencies come from
  wordfreq (CC BY-SA 4.0).
- Free browser on-device translation on Chromium with the built-in Translator
  API: no API key, no cost, and page text stays on the device. Language packs
  download from the settings page; any service below can be added later.
- OpenAI Chat Completions, OpenAI Responses, native Anthropic Claude and
  Google Gemini, DeepL, Google Cloud Translation, and Azure Translator profiles.
- Gateway-friendly services: custom request headers (secret values stay in
  local credential storage, never in settings), `api-key` authorization for
  Azure OpenAI, and base URLs with a non-secret query such as `?api-version=`.
  Per-service request limits (requests per minute, parallel requests, timeout,
  batch size) avoid rate-limit errors on free tiers.
- A Local gateway preset for Magpie, LiteLLM, One API, New API, and similar
  tools (default `http://127.0.0.1:3425/v1`, key optional). When a gateway
  reports each model's native endpoints, Lingo tags the model with its
  protocols and switches to a supported protocol on selection, so a
  Responses-only or Messages-only model is not sent through Chat Completions.
- Presets also include Azure OpenAI, xAI, Together AI, Fireworks AI, Tencent
  Hunyuan, Baidu Qianfan, and LM Studio.
- China and international provider presets, live model catalog import,
  automatic recommendations, manual selection, connection tests, and
  explicitly configured fallback chains. Catalog discovery does not call
  the translation API; the selected model is tested separately before saving.
- Custom services with a choice of OpenAI Chat Completions, OpenAI Responses,
  Anthropic Messages, or Gemini generateContent protocol. Service names and icons
  can be customized and saved locally without a translation test.
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
- Native browser sidebar controls, settings, keyboard shortcuts, context menus, an optional
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
2. Click Lingo in the toolbar and select **Connect service**. Configuration stays
   in the sidebar, including service management, reading preferences, and advanced
   settings. Choose a provider
   preset or add a custom service, enter its API key, and choose
   **Connect and load models**. Lingo loads
   the provider's catalog and recommends an available model, or you can search
   the list and choose one yourself. **Test translation and save** sends a
   short sample to the selected model before saving. If discovery is unavailable,
   enter the model or deployment ID supplied by your provider.
   For Ollama, start the local server and install a model first; a local
   connection normally needs no API key. DeepL users should select the
   API Free or API Pro plan that matches their key. Saving returns you to the page
   controls. **Back to page** keeps the connection draft in the panel so you can
   return and finish it. Drafts remain in memory and are not stored automatically;
   switching browser tabs or settings sections also preserves them.
3. Open an ordinary webpage and click Lingo in the toolbar to open its native
   browser sidebar, or use `Alt+Shift+L` to translate. Use the sidebar to change
   display mode or restore the original page.
4. Select webpage text and click the translation button, or use the shortcuts
   below. Open the independent text window from the sidebar or settings.

The sidebar shows your current service and model. Choose an imported model there
to change the current translation; Lingo keeps the display mode and content
scope. Automatic recommendations apply when importing or refreshing the list,
not during translation. Refreshing does not replace a manual choice.

The main panel has a **Translation appearance** shortcut to its reading controls.
Font, size,
line height, spacing, color, and separators update translated content without
requesting another translation. Chromium uses the native Side Panel and adds
the `sidePanel` permission; Firefox uses its native Sidebar. The compact popup
page remains available for compatibility tests and is no longer the toolbar's
default action. If translation fails, display controls and language, service, and
model selection remain available. **Original** temporarily hides the translated
text; **Stop translation** ends the session and removes it.

Connected services can be edited without re-entering their saved API key.
Adding a service makes it the default; editing an existing service preserves
the default and fallback order. Credentials and imported model catalogs remain
in the local browser profile.

Choose **Add a custom service** to connect your own gateway. Select the API
protocol from its documentation: **OpenAI Chat Completions**, **OpenAI Responses**,
**Anthropic Messages**, or **Gemini generateContent**. The OpenAI and DeepSeek
presets also offer a choice between Chat Completions and Responses. Enter the
documented API base URL; a service may accept a root URL or require a version
path such as `/v1` or `/v1beta`. Keep model IDs as returned, including provider
and routing-group prefixes. Local HTTP services may have an optional
authentication key; use the gateway's configured key when required.

Model catalogs are available automatically for most presets, including MiniMax.
SiliconFlow requests chat models and Mistral excludes archived or non-chat models.
Doubao currently requires a model or deployment ID. Zhipu catalog discovery is
attempted with manual entry available; its public catalog contract has not been
verified. DeepL, Google Cloud Translation, and Azure Translator do not require
an AI model. See the [configuration matrix and manual checks](./docs/ui/README.md#接入范围)
for the per-service behavior. This describes supported contracts, not successful
authentication for every provider account.

Responses sends requests to `/responses` and reads the Responses output format.
It is a common protocol supported by OpenAI, DeepSeek, and compatible gateways.
DeepSeek documents JSON output through `text.format`, alongside Chat Completions
and its Anthropic-compatible API. See the [DeepSeek Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
and [API reference](https://api-docs.deepseek.com/api/create-response/).

Model discovery failures show a localized explanation, the catalog request
address, and the HTTP status when available. Check the service protocol,
base URL, and credentials, then retry or enter a model ID manually. If the
background worker does not respond, use **Reload Lingo** and reopen settings.
An earlier installed Chromium extension check read 36 models from a real local
Magpie gateway through Chat Completions, Anthropic, and Gemini using GET requests
only. The Responses check also read 36 models through the installed settings UI
using the gateway's root address, selected a routing group, and retained seven
Codex model IDs in a separate GET check against its `/v1` base. All real gateway
checks used GET only. A simulated service verifies Responses discovery, model
selection, translation testing, save/reopen, and subsequent webpage translation
through `/responses`.

A separate authorized DeepSeek check through a temporary installed extension
successfully loaded `/models` from `https://api.deepseek.com` in the settings UI,
returning `deepseek-flash` and `deepseek-v4-pro` and recommending Flash.
The Flash model successfully translated
one short sample through Responses and one through Chat Completions using the
extension's real request and response handling. Live generation was limited to
these two samples; no real-account service save or credential persistence was
tested. No service or credential was saved, and the temporary browser was closed
after verification. Automated generation regressions use simulated services.

Settings prioritize **Translation services** and **Reading preferences**.
Translation style, terminology, website compatibility, cache controls, and
diagnostics are in collapsed **Advanced** sections. Website adaptations are
kept because they help identify article content and exclude menus/code;
their JSON and community-subscription controls are optional advanced tools.
See the [interface walkthrough](./docs/ui/README.md) for provider details and screenshots.
The walkthrough also lists [manual checks](./docs/ui/README.md#用户手测) for the
reader's own service account and webpages.

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
