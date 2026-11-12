'use client';

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { Button, Input, Label } from '@autional/ui';
import { PublicAuthConfigBySlugByBySlug } from '@autional/shared/generated/api';
import { requestAccountRecovery, resetAccountRecovery } from '@/lib/api-tenant';
import { completeAccountRecovery, verifyRecoveryCode } from '@/lib/api';
import { useTenantAuthConfigBySlug } from '@/hooks/use-tenant-auth-config';
import { processPasswordForTransmission } from '@autional/shared';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { PasswordInput } from '@/components/form/PasswordInput';
import { useTenantBrandingStore } from '@autional/shared/branding';

export default function RecoverAccountPage() {
	const { t } = useI18n();
	usePageTitle('auth.recoverAccount.title');
	const logoUrl = useTenantBrandingStore((s) => s.branding?.logoUrl);

	const [step, setStep] = useState<'request' | 'reset' | 'success'>('request');
	// 找回方式：邮箱/短信验证码（默认）或账号级一次性恢复码
	const [mode, setMode] = useState<'code' | 'recovery-code'>('code');
	const [identity, setIdentity] = useState('');
	const [maskedTarget, setMaskedTarget] = useState('');
	const [code, setCode] = useState('');
	const [newPassword, setNewPassword] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const { tenantSlug: slugParam } = useParams();
	const tenantSlug = slugParam || null;
	// WS-G G2（AUTH-04）：租户唯一来源 = slug 认证配置；不从默认租户兜底。
	const { data: slugAuthConfig } = useTenantAuthConfigBySlug(tenantSlug);
	const tenantId = slugAuthConfig?.tenantId || '';

	const handleRequestRecovery = async () => {
		if (!identity.trim()) return;
		if (!tenantId) {
			setError(t('error.tenant_required'));
			return;
		}
		setLoading(true);
		setError('');
		try {
			const res = await requestAccountRecovery(identity.trim(), tenantId);
			// 反枚举一致响应：账号是否存在都进入验证步（提示统一，不泄露账号存在性）
			setMaskedTarget(res?.maskedTo || '');
			setStep('reset');
		} catch (err: any) {
			setError(err?.response?.data?.message || t('auth.recoverAccount.requestFailed'));
		} finally {
			setLoading(false);
		}
	};

	// 恢复码方式：verify 换 token → complete 改密（与 OTP 找回共用 complete 端点）
	const handleRecoveryCodeReset = async () => {
		if (!identity.trim() || !code.trim() || newPassword.length < 8) return;
		setLoading(true);
		setError('');
		try {
			if (!tenantSlug) {
				throw new Error('recover-account tenant context missing');
			}
			const authConfig = await PublicAuthConfigBySlugByBySlug(tenantSlug);
			const transmissionMode = authConfig?.passwordPolicy?.passwordTransmission;
			if (transmissionMode === undefined || transmissionMode === '' || transmissionMode === null) {
				throw new Error('password transmission mode is missing from tenant auth-config');
			}
			const resolvedTenantId =
				(authConfig as any)?.tenantId || (authConfig as any)?.tenant_id || tenantId;
			if (!resolvedTenantId) {
				throw new Error('tenant id missing from auth-config');
			}
			const transmissionResult = await processPasswordForTransmission(
				newPassword,
				transmissionMode,
				resolvedTenantId,
				undefined,
			);
			const normalizedCode = code.trim().toUpperCase();
			const verified: any = await verifyRecoveryCode({
				identity: identity.trim(),
				code: normalizedCode,
				tenantId: resolvedTenantId,
			});
			const recoveryToken =
				verified?.recoveryToken || verified?.recovery_token || verified?.data?.recoveryToken;
			if (!recoveryToken) {
				throw new Error('recovery token missing from response');
			}
			await completeAccountRecovery({
				recoveryToken,
				code: normalizedCode,
				newPassword: transmissionResult.password,
				passwordTransmission: transmissionResult.passwordTransmission,
				tenantId: resolvedTenantId,
			});
			setStep('success');
		} catch (err: any) {
			setError(err?.response?.data?.message || t('auth.recoverAccount.recoveryCodeFailed'));
		} finally {
			setLoading(false);
		}
	};

	const handleResetPassword = async () => {
		if (!code.trim() || !newPassword || newPassword.length < 8) return;
		setLoading(true);
		setError('');
		try {
			// 2026-08-17 修复：必须根据租户配置决定密码传输模式。
			// tenantSlug 缺失 = 无法确定模式，不能静默发明文（hash 租户会 61000104）。
			if (!tenantSlug) {
				throw new Error('recover-account tenant context missing, cannot determine password transmission mode');
			}
			const authConfig = await PublicAuthConfigBySlugByBySlug(tenantSlug);
			const mode = authConfig?.passwordPolicy?.passwordTransmission;
			if (mode === undefined || mode === '' || mode === null) {
				throw new Error(
					'password transmission mode is missing from tenant auth-config (contract error)',
				);
			}
			const resolvedTenantId =
				(authConfig as any)?.tenantId || (authConfig as any)?.tenant_id || tenantId;
			if (!resolvedTenantId) {
				throw new Error('tenant id missing from auth-config, cannot hash password');
			}
			const transmissionResult = await processPasswordForTransmission(
				newPassword,
				mode,
				resolvedTenantId,
				undefined,
			);
			await resetAccountRecovery({
				identity: identity.trim(),
				code: code.trim(),
				newPassword: transmissionResult.password,
				passwordTransmission: transmissionResult.passwordTransmission,
				tenantId: resolvedTenantId,
			});
			setStep('success');
		} catch (err: any) {
			setError(err?.response?.data?.message || t('auth.recoverAccount.resetFailed'));
		} finally {
			setLoading(false);
		}
	};

	return (
		<AuthCard logoUrl={logoUrl}>
			<AuthHeader
				title={t('auth.recoverAccount.title')}
				subtitle={t('auth.recoverAccount.subtitle')}
			/>

			{step === 'request' && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (mode === 'recovery-code') {
							handleRecoveryCodeReset();
						} else {
							handleRequestRecovery();
						}
					}}
					className="space-y-4"
				>
					<div className="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant={mode === 'code' ? undefined : 'outline'}
							onClick={() => {
								setMode('code');
								setError('');
							}}
						>
							{t('auth.recoverAccount.modeCode')}
						</Button>
						<Button
							type="button"
							variant={mode === 'recovery-code' ? undefined : 'outline'}
							onClick={() => {
								setMode('recovery-code');
								setError('');
							}}
						>
							{t('auth.recoverAccount.modeRecoveryCode')}
						</Button>
					</div>

					<div className="space-y-2">
						<Label htmlFor="identity">{t('auth.recoverAccount.identityLabel')}</Label>
						<Input
							id="identity"
							type="text"
							placeholder="user@example.com / 13800138000"
							value={identity}
							onChange={(e) => setIdentity(e.target.value)}
						/>
					</div>

					{mode === 'recovery-code' && (
						<>
							<div className="space-y-2">
								<Label htmlFor="recoveryCode">{t('auth.recoverAccount.recoveryCodeLabel')}</Label>
								<Input
									id="recoveryCode"
									type="text"
									placeholder={t('auth.recoverAccount.recoveryCodePlaceholder')}
									maxLength={11}
									value={code}
									onChange={(e) => setCode(e.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="recoveryNewPassword">{t('auth.recoverAccount.newPasswordLabel')}</Label>
								<PasswordInput
									id="recoveryNewPassword"
									autoComplete="new-password"
									showStrength
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
								/>
							</div>
						</>
					)}

					{error && (
						<div className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">
							{error}
						</div>
					)}
					<Button type="submit" fullWidth isLoading={loading}>
						{mode === 'recovery-code'
							? t('auth.recoverAccount.resetPassword')
							: t('auth.recoverAccount.sendCode')}
					</Button>
				</form>
			)}

			{step === 'reset' && (
				<form
					onSubmit={(e) => {
						e.preventDefault();
						handleResetPassword();
					}}
					className="space-y-4"
				>
					{/* 密码表单语义：隐藏 username 供密码管理器/AT 识别输入目的（与改密/注销页同口径）。 */}
					<input
						type="text"
						name="username"
						autoComplete="username"
						value={identity}
						readOnly
						hidden
					/>
					<div className="rounded-md bg-[var(--color-bg-muted)] p-3 text-sm text-[var(--color-text-secondary)]">
						{maskedTarget
							? t('auth.recoverAccount.codeSent', { target: maskedTarget })
							: t('auth.recoverAccount.codeSentGeneric')}
					</div>
					<div className="space-y-2">
						<Label htmlFor="code">{t('auth.recoverAccount.codeLabel')}</Label>
						<Input
							id="code"
							type="text"
							placeholder="000000"
							maxLength={6}
							value={code}
							onChange={(e) => setCode(e.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="newPassword">{t('auth.recoverAccount.newPasswordLabel')}</Label>
						<PasswordInput
							id="newPassword"
							autoComplete="new-password"
							showStrength
							value={newPassword}
							onChange={(e) => setNewPassword(e.target.value)}
						/>
					</div>
					{error && (
						<div className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">
							{error}
						</div>
					)}
					<Button type="submit" fullWidth isLoading={loading}>
						{t('auth.recoverAccount.resetPassword')}
					</Button>
				</form>
			)}

			{step === 'success' && (
				<div className="space-y-4 text-center">
					<div className="rounded-lg bg-success/10 p-6">
						<p className="text-sm font-medium text-success-text">
							{t('auth.recoverAccount.success')}
						</p>
					</div>
					<Link
						to={tenantSlug ? `/${tenantSlug}/login` : '/login'}
						className="inline-flex items-center text-sm text-brand-text hover:underline"
					>
						{t('auth.recoverAccount.backToLogin')}
					</Link>
				</div>
			)}

			<div className="text-center text-sm mt-4">
				<Link to={tenantSlug ? `/${tenantSlug}/login` : '/login'} className="text-brand-text hover:underline">
					{t('auth.recoverAccount.back')}
				</Link>
			</div>
		</AuthCard>
	);
}
