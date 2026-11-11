'use client';

import { useState, useMemo } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Input, Label } from '@autional/ui';
import { tenantPublicTenantsPost } from '@autional/shared/generated/api';
import { AuthCard } from '@/components/auth/AuthCard';
import { PasswordInput } from '@/components/form/PasswordInput';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { fetchLegalDocumentVersion } from '@/lib/legal-document';
import { createTrialSchema } from '@/lib/validators';
import type { TrialFormData } from '@/lib/validators';

/**
 * 自助试用租户注册（Trial UI）。
 *
 * 后端契约：`POST /tenant/api/v1/tenant/public/tenants`（公开、无需认证、429 限流）。
 * 管理员以 `admin_email` 开通（tenant 侧 T1 首选 admin_username，空则回退 admin_email）。
 * 成功后不建会话：管理员用刚设置的密码走正常登录。
 */
export default function TrialPage() {
	const { t, lang } = useI18n();
	usePageTitle('trial.title', t('auth.trial.title'));

	const [error, setError] = useState('');
	const [loading, setLoading] = useState(false);
	const [createdSlug, setCreatedSlug] = useState('');

	const schema = useMemo(() => createTrialSchema(t), [lang, t]);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<TrialFormData>({
		resolver: zodResolver(schema),
		defaultValues: { name: '', displayName: '', adminEmail: '', adminPassword: '', invitationCode: '' },
	});

	const onSubmit = async (data: TrialFormData) => {
		setLoading(true);
		setError('');
		try {
			const version = await fetchLegalDocumentVersion('terms', lang).catch(() => undefined);
			const res: any = await tenantPublicTenantsPost({
				name: data.name.trim().toLowerCase(),
				displayName: data.displayName?.trim() || undefined,
				adminEmail: data.adminEmail.trim(),
				adminPassword: data.adminPassword,
				invitationCode: data.invitationCode?.trim() || undefined,
				agreementAccepted: true,
				agreementVersion: version || undefined,
			});
			const slug = res?.name || res?.data?.name || data.name.trim().toLowerCase();
			setCreatedSlug(slug);
		} catch (err: any) {
			const body = err?.response?.data;
			const i18nKey = body?.i18n_key || body?.i18nKey;
			const localized = i18nKey ? t(i18nKey, '') : '';
			setError(localized || body?.message || t('auth.trial.error'));
		} finally {
			setLoading(false);
		}
	};

	if (createdSlug) {
		return (
			<AuthCard title={t('auth.trial.successTitle')} subtitle={t('auth.trial.successDesc')}>
				<div className="space-y-4">
					<div className="rounded-md border border-info-soft bg-info-soft p-3 text-sm text-info-text">
						{t('auth.trial.successSlug')}: <span className="font-mono font-medium">{createdSlug}</span>
					</div>
					<Link to={`/${createdSlug}/login`}>
						<Button type="button" fullWidth>
							{t('auth.trial.goToLogin')}
						</Button>
					</Link>
				</div>
			</AuthCard>
		);
	}

	return (
		<AuthCard title={t('auth.trial.title')} subtitle={t('auth.trial.subtitle')}>
			{error && (
				<div className="mb-4 rounded-md bg-danger/10 p-3 text-sm text-danger-text">{error}</div>
			)}

			<form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
				<div className="space-y-2">
					<Label htmlFor="name">{t('auth.trial.name')}</Label>
					<Input
						id="name"
						placeholder={t('auth.trial.namePlaceholder')}
						autoComplete="organization"
						{...register('name')}
						error={errors.name?.message}
					/>
					<p className="text-xs text-neutral-500">{t('auth.trial.nameHint')}</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="displayName">{t('auth.trial.displayName')}</Label>
					<Input
						id="displayName"
						placeholder={t('auth.trial.displayNamePlaceholder')}
						{...register('displayName')}
						error={errors.displayName?.message}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="adminEmail">{t('auth.trial.adminEmail')}</Label>
					<Input
						id="adminEmail"
						type="email"
						autoComplete="email"
						placeholder={t('auth.trial.adminEmailPlaceholder')}
						{...register('adminEmail')}
						error={errors.adminEmail?.message}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="adminPassword">{t('auth.trial.adminPassword')}</Label>
					<PasswordInput
						id="adminPassword"
						autoComplete="new-password"
						placeholder={t('auth.trial.adminPasswordPlaceholder')}
						{...register('adminPassword')}
						error={errors.adminPassword?.message}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="invitationCode">{t('auth.trial.invitationCode')}</Label>
					<Input
						id="invitationCode"
						placeholder={t('auth.trial.invitationCodePlaceholder')}
						{...register('invitationCode')}
						error={errors.invitationCode?.message}
					/>
					<p className="text-xs text-neutral-500">{t('auth.trial.invitationCodeHint')}</p>
				</div>

				<div className="flex items-start gap-2">
					<input
						id="agreeTerms"
						type="checkbox"
						className="mt-1 h-4 w-4 rounded border-[var(--color-border-strong)]"
						{...register('agreeTerms')}
					/>
					<label htmlFor="agreeTerms" className="text-xs text-neutral-600">
						{t('auth.trial.agreePrefix')}{' '}
						<Link to="/terms" className="text-brand hover:underline">
							{t('register.termsOfService')}
						</Link>{' '}
						{t('register.and')}{' '}
						<Link to="/privacy" className="text-brand hover:underline">
							{t('register.privacyPolicy')}
						</Link>
					</label>
				</div>
				{errors.agreeTerms?.message && (
					<p className="text-xs text-danger-text">{errors.agreeTerms.message}</p>
				)}

				<Button type="submit" fullWidth isLoading={loading}>
					{t('auth.trial.submit')}
				</Button>

				<p className="text-center text-xs text-neutral-500">
					{t('auth.trial.hasAccount')}{' '}
					<Link to="/login" className="text-brand hover:underline">
						{t('register.login')}
					</Link>
				</p>
			</form>
		</AuthCard>
	);
}
