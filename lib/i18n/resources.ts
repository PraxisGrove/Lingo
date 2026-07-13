import de from './resources/de.json';
import en from './resources/en.json';
import es from './resources/es.json';
import fr from './resources/fr.json';
import ja from './resources/ja.json';
import ko from './resources/ko.json';
import ptBR from './resources/pt-BR.json';
import zhCN from './resources/zh-CN.json';
import zhTW from './resources/zh-TW.json';

export const resources = {
  en: { translation: en },
  'zh-CN': { translation: zhCN },
  'zh-TW': { translation: zhTW },
  ja: { translation: ja },
  ko: { translation: ko },
  es: { translation: es },
  fr: { translation: fr },
  de: { translation: de },
  'pt-BR': { translation: ptBR },
} as const;

export type MessageKey = keyof typeof en;
