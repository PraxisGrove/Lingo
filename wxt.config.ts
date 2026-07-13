import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: ['storage', 'contextMenus'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_extensionName__',
    },
    commands: {
      'toggle-page-translation': {
        suggested_key: {
          default: 'Alt+Shift+L',
        },
        description: '__MSG_toggleCommandDescription__',
      },
    },
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
