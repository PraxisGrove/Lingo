# Lingo Translation

Lingo is an open-source bilingual webpage translation extension. It keeps the
original text in context and sends content only to the translation service the
reader explicitly configures.

The repository currently contains the product and technical design plus the
productized extension foundation. The end-to-end translation workflow is the
next implementation stage.

## Product Design

- [Domain language](./CONTEXT.md)
- [Product plan](./docs/product-plan.md)
- [Technical architecture](./docs/technical-architecture.md)
- [Implementation plan](./docs/implementation-plan.md)
- [Architecture decisions](./docs/adr/)

## Development

Prerequisites are Node.js 22 and pnpm 11.

```bash
pnpm install
pnpm dev
pnpm compile
pnpm test
pnpm check
pnpm build
```

Use `pnpm dev:firefox`, `pnpm build:firefox`, or `pnpm zip:firefox` for
Firefox. Chrome and Edge use the default Chromium build.

## Privacy and Permissions

Lingo requests access to webpages so it can identify and present translated
content. Phase 0 does not make translation requests or collect telemetry.
Future translation requests will go directly from the extension background
worker to the service selected by the reader.

See the [privacy policy](./PRIVACY.md), [permission explanation](./docs/permissions.md),
and [security policy](./SECURITY.md) for the current guarantees and reporting
process.

## Contributing and License

See [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting changes. Lingo is
licensed under the [GNU Affero General Public License v3.0](./LICENSE). External
contributions require agreement to the [CLA](./CLA.md). The CLA and other legal
texts require legal review before the first public release.
