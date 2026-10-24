'use client';

import { useState, useEffect, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Label } from '@autional/ui';
import { createResetPasswordSchema } from '@/lib/validators';
import { PublicAuthConfigByAuthConfig } from '@autional/shared/generated/api';
import { resetPassword, verifyResetCode } from '@/lib/api-tenant';
import { processPasswordForTransmission } from '@autional/shared';
import { checkPasswordBreached } from '@/lib/breach-check';
import type { ResetPasswordFormData } from '@/lib/validators';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { PasswordInput } from '@/components/form/PasswordInput';
import { LoadingScreen } from '@autional/ui';
import { ErrorState } from '@autional/ui';
import RedirectCountdown from '@/components/ui/RedirectCountdown';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';

function ResetPasswordContent() {
	const { t } = useI18n();
	usePageTitle('auth.resetPassword.title');
	const navigate = useNavigate();
	const schema = createResetPasswordSchema(t);
	const [searchParams] = useSearchParams();
	const token = searchParams.get('token') || '';
	const identity = sessionStorage.getItem('reset_password_identity') || '';
	// WS-G G2（R3 m-11/m-12）：query 优先 → sessionStorage；根路由不回落默认租户。
	const queryTenantId = searchParams.get('tenant_id') || '';
	const tenantId = queryTenantId || sessionStorage.getItem('reset_password_tenant_id') || '';

	const [verifying, setVerifying] = useState(true);
	const [tokenValid, setTokenValid] = useState(false);
	const [tokenError, setTokenError] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [success, setSuccess] = useState(false);

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<ResetPasswordFormData>({
		resolver: zodResolver(schema),
	});

	useEffect(() => {
		if (!token) {
			setVerifying(false);
			setTokenError(t('auth.resetPassword.invalidToken'));
			return;
		}

		// AUTH-04（AC-G5）：缺租户 → 错误页，不发请求（不猜测、不回落默认租户）。
		if (!tenantId) {
			setVerifying(false);
			setTokenError(t('error.tenant_required'));
			return;
		}

		verifyResetCode(identity, token, tenantId)
			.then((res: any) => {
				// VerifyResetCode 返回租户（服务端权威）：留存供后续提交/刷新使用。
				const resolvedTenantId = res?.tenantId ?? res?.tenant_id ?? '';
				if (resolvedTenantId) {
					sessionStorage.setItem('reset_password_tenant_id', resolvedTenantId);
				}
				setTokenValid(true);
			})
			.catch((err: any) => {
				setTokenError(err.response?.data?.message || t('auth.resetPassword.expiredToken'));
			})
			.finally(() => {
				setVerifying(false);
			});
	}, [token, tenantId]);

	const onSubmit = async (data: ResetPasswordFormData) => {
		// HIBP k-anonymity breach check — per NIST SP 800-63B §5.1.1.2
		try {
			const breachCheck = await checkPasswordBreached(data.password);
			if (breachCheck.breached) {
				setTokenError(t('auth.password.breachedWarning', { count: breachCheck.count }));
				return;
			}
		} catch {
			// Breach check API unavailable — fail-open
		}

		setSubmitting(true);
		try {
			// 2026-08-17 修复：必须根据租户配置决定密码传输模式。
			// tenant_id 来自 query/sessionStorage（WS-G G2）；缺失 = 无法确定模式，
			// 不能静默发明文（hash 租户会 61000104），必须报错暴露。
			if (!tenantId) {
				throw new Error('reset tenant context missing, cannot determine password transmission mode');
			}
			const authConfig = await PublicAuthConfigByAuthConfig(tenantId);
			const mode = authConfig?.passwordPolicy?.passwordTransmission;
			if (mode === undefined || mode === '' || mode === null) {
				throw new Error(
					'password transmission mode is missing from tenant auth-config (contract error)',
				);
			}
			const transmissionResult = await processPasswordForTransmission(
				data.password,
				mode,
				tenantId,
				undefined,
			);
			await resetPassword({
				code: token,
				identity,
				newPassword: transmissionResult.password,
				passwordTransmission: transmissionResult.passwordTransmission,
				tenantId,
			});
			setSuccess(true);
		} catch (err: any) {
			setTokenError(err.response?.data?.message || t('auth.resetPassword.failed'));
		} finally {
			setSubmitting(false);
		}
	};

	if (verifying) {
		return (
			<AuthCard>
				<AuthHeader title={t('reset.title')} subtitle={t('reset.subtitle')} />
				<div className="py-8 text-center text-sm text-neutral-500">
					{t('auth.resetPassword.verifying')}
				</div>
			</AuthCard>
		);
	}

	if (success) {
		return (
			<RedirectCountdown
				title={t('auth.resetPassword.success')}
				subtitle={t('auth.common.redirectingIn')}
				continueLabel={t('auth.common.continue')}
				onContinue={() => navigate('/')}
			/>
		);
	}

	if (!tokenValid) {
		return (
			<AuthCard>
				<AuthHeader title={t('reset.title')} subtitle={t('reset.subtitle')} />
				<ErrorState
					title={tokenError || t('auth.resetPassword.expiredToken')}
					description={t('auth.resetPassword.invalidTokenDesc')}
					action={{ label: t('common.retry'), onClick: () => navigate('/') }}
				/>
			</AuthCard>
		);
	}

	return (
		<AuthCard>
			<AuthHeader
				title={t('auth.resetPassword.title')}
				subtitle={t('auth.resetPassword.subtitle')}
			/>

			<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="password">{t('auth.resetPassword.newPassword')}</Label>
					<PasswordInput
						id="password"
						placeholder={t('auth.resetPassword.passwordPlaceholder')}
						showStrength
						{...register('password')}
						error={errors.password?.message}
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="confirmPassword">{t('auth.resetPassword.confirmNewPassword')}</Label>
					<PasswordInput
						id="confirmPassword"
						placeholder={t('auth.resetPassword.confirmPasswordPlaceholder')}
						{...register('confirmPassword')}
						error={errors.confirmPassword?.message}
					/>
				</div>

				{tokenError && (
					<div className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">
						{tokenError}
					</div>
				)}

				<Button type="submit" fullWidth isLoading={submitting}>
					{t('auth.resetPassword.submit')}
				</Button>
			</form>

			<div className="text-center text-sm">
				<Link to="/" className="text-brand-text hover:underline">
					{t('auth.common.backToLogin')}
				</Link>
			</div>
		</AuthCard>
	);
}

function ResetPasswordPage() {
	const { t } = useI18n();

	return (
		<Suspense fallback={<LoadingScreen message={t('auth.common.loading')} />}>
			<ResetPasswordContent />
		</Suspense>
	);
}

export default ResetPasswordPage;
