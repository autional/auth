export type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong' | 'very-strong';

export interface PasswordPolicy {
	minLength?: number;
	maxLength?: number;
	requireUpper?: boolean;
	requireLower?: boolean;
	requireDigit?: boolean;
	requireSpecial?: boolean;
	minStrength?: number;
}

export interface StrengthResult {
	level: StrengthLevel;
	score: number;
	/** Localized strength label (resolved via the caller's i18n t) */
	label: string;
	/** Localized improvement suggestions */
	suggestions: string[];
}

/**
 * Calculate password strength with optional policy constraints.
 * Score range: 0-5. Mapping:
 *   0 => weak, 1 => fair, 2 => good, 3 => strong, 4-5 => very-strong
 *
 * t 为必需参数：全部展示文案从 i18n bundle 解析（文件内不留中文兜底字面量）。
 */
export function calculateStrength(
	password: string,
	policy: PasswordPolicy | undefined,
	t: (key: string, options?: Record<string, any>) => string,
): StrengthResult {
	if (!password) {
		return { level: 'weak', score: 0, label: '', suggestions: [] };
	}

	const hasUpper = /[A-Z]/.test(password);
	const hasLower = /[a-z]/.test(password);
	const hasDigit = /\d/.test(password);
	const hasSpecial = /[^a-zA-Z0-9]/.test(password);

	const checks = {
		minLength: password.length >= (policy?.minLength || 8),
		uppercase: !policy?.requireUpper || hasUpper,
		lowercase: !policy?.requireLower || hasLower,
		digit: !policy?.requireDigit || hasDigit,
		special: !policy?.requireSpecial || hasSpecial,
		lengthBonus: password.length >= 12,
	};

	let score = 0;
	if (checks.minLength) score++;
	if (checks.lengthBonus) score++;
	if (checks.uppercase && hasUpper) score++;
	if (checks.lowercase && hasLower) score++;
	if (checks.digit) score++;
	if (checks.special) score++;

	const levels: StrengthLevel[] = ['weak', 'fair', 'good', 'strong', 'very-strong', 'very-strong'];
	const level = levels[Math.min(score, 5)];

	const labels: Record<StrengthLevel, string> = {
		weak: t('password.strength.weak'),
		fair: t('password.strength.fair'),
		good: t('password.strength.good'),
		strong: t('password.strength.strong'),
		'very-strong': t('password.strength.veryStrong'),
	};

	const suggestions: Record<StrengthLevel, string[]> = {
		weak: [t('password.strength.suggestionWeak')],
		fair: [t('password.strength.suggestionFair')],
		good: [t('password.strength.suggestionGood')],
		strong: [t('password.strength.suggestionStrong')],
		'very-strong': [t('password.strength.suggestionVeryStrong')],
	};

	const policySuggestions: string[] = [];
	if (policy?.requireUpper && !hasUpper) {
		// ...
	}
	if (policy?.requireLower && !hasLower) {
		// ...
	}
	if (policy?.requireDigit && !hasDigit) {
		// ...
	}
	if (policy?.requireSpecial && !hasSpecial) {
		// ...
	}
	if ((policy?.minLength || 8) > password.length) {
		const min = policy?.minLength || 8;
		policySuggestions.push(t('password.strength.minLength', { min }));
	}

	return {
		level,
		score,
		label: labels[level],
		suggestions: policySuggestions.length > 0 ? policySuggestions : suggestions[level],
	};
}
