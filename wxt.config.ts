import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      // The toolbar opens the persistent native panel. Keep the popup page
      // available as a compact compatibility surface without binding it here.
      if (manifest.action) delete manifest.action.default_popup;
      if (manifest.browser_action) delete manifest.browser_action.default_popup;
      if (manifest.manifest_version === 3) {
        manifest.minimum_chrome_version = '114';
        manifest.permissions = [...(manifest.permissions ?? []), 'offscreen'];
      }
    },
  },
  manifest: {
    default_locale: 'en',
    name: '__MSG_extensionName__',
    description: '__MSG_extensionDescription__',
    permissions: ['storage', 'contextMenus', 'webNavigation'],
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
