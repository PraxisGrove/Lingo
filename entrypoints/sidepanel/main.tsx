import React from 'react';
import ReactDOM from 'react-dom/client';
import { changeInterfaceLanguage } from '@/lib/i18n/i18n';
import { getSettings } from '@/lib/storage/settings';
import SidepanelApp from './SidepanelApp';
import '../popup/style.css';

async function render() {
  const root = document.getElementById('root');
  if (!root) throw new Error('Root element not found');
  const settings = await getSettings();
  await changeInterfaceLanguage(settings.uiLocale);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <SidepanelApp />
    </React.StrictMode>,
  );
}

void render();
