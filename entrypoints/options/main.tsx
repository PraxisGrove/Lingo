import React from 'react';
import ReactDOM from 'react-dom/client';
import { changeInterfaceLanguage, translate } from '@/lib/i18n/i18n';
import { getSettings } from '@/lib/storage/settings';
import OptionsApp from './OptionsApp.tsx';
import './style.css';

async function render() {
  const root = document.getElementById('root');

  if (root == null) {
    throw new Error('Root element not found');
  }

  const settings = await getSettings();
  await changeInterfaceLanguage(settings.uiLocale);
  document.title = `${translate('options.title.settings')} - Lingo`;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <OptionsApp />
    </React.StrictMode>,
  );
}

void render();
