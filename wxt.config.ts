import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Lingo Translation',
    description:
      'Read translated webpages alongside the original text using your chosen translation service.',
    permissions: ['storage'],
    host_permissions: ['<all_urls>'],
    browser_specific_settings: {
      gecko: {
        id: '{9c2a196c-70d1-4bd5-9d34-e607f63ef6b8}',
        data_collection_permissions: {
          required: ['none'],
          optional: [],
        },
      },
    },
  },
});
