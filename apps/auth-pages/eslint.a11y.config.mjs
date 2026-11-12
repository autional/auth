// a11y 专用 flat config —— 无障碍闸门铺开（2026-11-12 · 分母体系 AC C-28 / ui-denominator G5·G6）
// 与 admin-console 试点同一份口径（`pnpm lint:a11y` 必须 0 error/warn）。
//
// 为什么单独一份，而不是塞进 eslint.config.mjs：
//   1. 共享配置 `@autional/eslint-config` 在本仓是**已发布版本**（0.1.0-rc.1），规则改不了；
//      DS 侧 0.2.0-rc.1 已把同一套规则写进 `packages/eslint-config/index.js`，
//      等它发布后本文件即可删除（改回 `export default config` 一行）。
//   2. 存量 lint（no-explicit-any / no-unused-vars）噪音大；a11y 闸门要能独立回答
//      「这次有没有新增无障碍回归」，否则会被无关告警埋掉。
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config({
	files: ['**/*.{ts,tsx,js,jsx}'],
	languageOptions: {
		parser: tseslint.parser,
		parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
	},
	// react-hooks 只登记插件、不开规则：仓内历史 disable 注释引用了该插件，
	// 插件缺席时 ESLint 会把「禁用了未定义规则」直接报成 error。同时关掉
	// reportUnusedDisableDirectives：本配置不跑 react-hooks，那类 disable 在这里必然是假信号。
	linterOptions: { reportUnusedDisableDirectives: 'off' },
	plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
	rules: { ...jsxA11y.flatConfigs.recommended.rules },
});
