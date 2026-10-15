import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Locale files are FLAT: every key is a dot-separated literal string at root level
// (e.g. "login.title"; the legacy family keeps the "auth." prefix, newer keys omit it).
// Nested objects are FORBIDDEN — the 2026-10-15 surgery removed all 31 legacy nested
// blocks (unreachable under keySeparator: false; ~700 lines per bundle).
// RUNTIME CONTRACT: t('a.b.c') matches the literal root key "a.b.c"; dots never
// traverse objects. A nested entry would render as a raw key in the UI (the E3N
// logout-confirm defect). Enforced by i18n-guard lock ④ (src/lib/__tests__/i18n-guard.test.ts).
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
		// keySeparator: false — dots in keys are literal characters, not path separators.
		// Required: all locale keys are flat root-level strings and lookups are exact.
		// DO NOT REMOVE without restructuring ALL locale files AND ALL t() call sites.
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
