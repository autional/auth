import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Locale files use dot-separated keys at root level (e.g. "login.title", "auth.login.passwordTab").
// Both formats coexist: legacy keys from the original nested structure have "auth." prefix;
// newer keys from the flat migration omit it.
// The default keySeparator '.' is used so i18next traverses the nested object paths correctly.
// IMPORTANT: When adding new locale keys, prefer the dot-separated nested format
// (e.g. { "login": { "title": "..." } } over { "login.title": "..." }).
// Both work, but nested is more maintainable.
import zhCN from './locales/zh-CN.json';
import enUS from './locales/en-US.json';
import { FALLBACK_LANG, localeOf } from '@/lib/site-env';

i18n
	.use(LanguageDetector)
	.use(initReactI18next)
	.init({
		resources: {
			'zh-CN': { translation: zhCN },
			'en-US': { translation: enUS },
		},
		fallbackLng: localeOf(FALLBACK_LANG),
		// keySeparator: false means dots in keys are treated as literal characters,
		// not path separators. Required because locale files contain flat keys like
		// "auth.login.passwordTab" alongside nested keys like { login: { title: "..." } }.
		// Both formats coexist due to the mixed migration from nested to flat structure.
		// DO NOT REMOVE this setting without also restructuring ALL locale files and
		// ALL component t() calls to use consistent key format.
		keySeparator: false,
		interpolation: { escapeValue: false },
		detection: {
			// navigator 探测关停：首访语言 = 区域默认（B3 单源双区契约，见 docs/positioning/24）；
			// querystring/localStorage 仅承载显式语言选择。
			order: ['querystring', 'localStorage'],
			caches: ['localStorage'],
			lookupQuerystring: 'lang',
		},
	});

export default i18n;
