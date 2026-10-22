'use client';

import { useState, useEffect, useMemo, type KeyboardEvent } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Input, Label } from '@autional/ui';
import {
	loginWithTokens,
	decodeJwtPayload,
	extractApiError,
	usePublicTenantSlugs,
} from '@autional/shared';
import { createMfaTOTPSchema, createMfaSMSSchema } from '@/lib/validators';
import type { MFATOTPFormData, MFASMSFormData } from '@/lib/validators';
import { verifyMFAChallenge, sendMFAChallengeCode } from '@/lib/api.generated';
import { anchorSessionFromToken } from '@/lib/anchor-session';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';
import { AuthCard } from '@/components/auth/AuthCard';
import { AuthHeader } from '@/components/auth/AuthHeader';
import { semanticsOfError } from '@/lib/error-semantics';

type CodeMethod = 'totp' | 'sms' | 'email' | 'backup';

// 登录页/mfa-setup 写入的挑战会话（oauth/callback 写入子集：无 email/phone/riskLevel）
interface PreAuthData {
	challengeToken: string;
	tenantId?: string;
	riskLevel?: string;
	requiredMfaMethods?: string[];
	enrolledMfaMethods?: string[];
	email?: string;
	phone?: string;
}

const CODE_METHOD_ORDER: CodeMethod[] = ['totp', 'sms', 'email', 'backup'];

// 分流由契约驱动（@/lib/error-semantics）：
//   61000403（挑战令牌无效/过期） → ui_observation='reauth_required' ⇒ 回登录
//   61000402（验证码错误）       → ui_observation='form_error'      ⇒ 留本页

// 展示用脱敏（仅渲染，不参与鉴权）
function maskContact(value: string): string {
	if (!value) return '';
	if (value.includes('@')) {
		const [local, domain] = value.split('@');
		return `${local.slice(0, 2)}***@${domain}`;
	}
	return value.replace(/^(\+?\d{3})\d+(\d{4})$/, '$1****$2');
}

/**
 * 可见验证方式 = 用户已开通的码方法（identity 回传 enrolled_mfa_methods）；
 * 未回传时回落风险策略列表，两者皆空才展示全部码方法（历史兼容）。
 * password 是基线、webauthn 无码面，均不在标签页展示。
 * 备用码与 TOTP 同腿验证（mfa 侧 ValidateTOTP 内含一次性消费回退），随 TOTP 一并展示。
 */
function deriveTabs(required?: string[], enrolled?: string[]): CodeMethod[] {
	const codeOnly = (list?: string[]) =>
		(list || []).filter(
			(m): m is 'totp' | 'sms' | 'email' => m === 'totp' || m === 'sms' || m === 'email',
		);
	const policy = codeOnly(required);
	const enrolledCode = codeOnly(enrolled);
	const base: CodeMethod[] =
		enrolledCode.length > 0 ? enrolledCode : policy.length > 0 ? policy : ['totp', 'sms', 'email'];
	const withBackup: CodeMethod[] = base.includes('totp') ? [...base, 'backup'] : base;
	return CODE_METHOD_ORDER.filter((m) => withBackup.includes(m));
}

type BackupFormData = { code: string };

// 与服务端发送限流窗口一致（identity: 1 次/60s/用户/方法）
const RESEND_COOLDOWN_SECONDS = 60;

export default function MFAChallengePage() {
	const { t, lang } = useI18n();
	usePageTitle('mfa.challenge.title');
	const navigate = useNavigate();
	const { tenantSlug } = useParams<{ tenantSlug?: string }>();
	const loginPath = tenantSlug ? `/${tenantSlug}/login` : '/';
	const dashboardPath = tenantSlug ? `/${tenantSlug}/dashboard` : '/dashboard';
	const { data: knownTenants } = usePublicTenantSlugs();

	const mfaTotpSchema = createMfaTOTPSchema(t);
	const mfaSmsSchema = createMfaSMSSchema(t);
	const backupSchema = useMemo(
		() =>
			z.object({
				code: z.string().length(8, t('validation.backupCodeLength')),
			}),
		[lang, t],
	);

	const [preAuth, setPreAuth] = useState<PreAuthData | null>(null);
	const [fatal, setFatal] = useState<'' | 'expired'>('');
	const [activeTab, setActiveTab] = useState<CodeMethod>('totp');
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState('');
	const [announcement, setAnnouncement] = useState('');
	// 验证码发送（仅 sms/email 有"发送"语义；TOTP/备用码不需要）
	const [sendingMethod, setSendingMethod] = useState<'' | 'sms' | 'email'>('');
	const [sentMethods, setSentMethods] = useState<Partial<Record<'sms' | 'email', boolean>>>({});
	const [cooldown, setCooldown] = useState<Record<'sms' | 'email', number>>({ sms: 0, email: 0 });

	useEffect(() => {
		if (cooldown.sms <= 0 && cooldown.email <= 0) return;
		const id = setTimeout(() => {
			setCooldown((c) => ({
				sms: Math.max(0, c.sms - 1),
				email: Math.max(0, c.email - 1),
			}));
		}, 1000);
		return () => clearTimeout(id);
	}, [cooldown]);

	// AUTH-36：挂载即校验挑战会话（存在性 + 签名令牌未过期）；无效不渲染死表单
	useEffect(() => {
		const raw = sessionStorage.getItem('mfa_pre_auth');
		if (!raw) {
			navigate(loginPath, { replace: true });
			return;
		}
		let parsed: PreAuthData | null = null;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = null;
		}
		const payload = parsed?.challengeToken ? decodeJwtPayload(parsed.challengeToken) : null;
		const exp = typeof (payload as any)?.exp === 'number' ? (payload as any).exp : 0;
		if (!parsed?.challengeToken || !payload || exp <= 0 || exp * 1000 <= Date.now()) {
			sessionStorage.removeItem('mfa_pre_auth');
			setFatal('expired');
			return;
		}
		setPreAuth(parsed);
	}, [navigate, loginPath]);

	const tabs = useMemo(
		() => deriveTabs(preAuth?.requiredMfaMethods, preAuth?.enrolledMfaMethods),
		[preAuth],
	);

	useEffect(() => {
		if (preAuth && !tabs.includes(activeTab)) {
			setActiveTab(tabs[0]);
		}
	}, [preAuth, tabs, activeTab]);

	const totpForm = useForm<MFATOTPFormData>({ resolver: zodResolver(mfaTotpSchema) });
	const smsForm = useForm<MFASMSFormData>({ resolver: zodResolver(mfaSmsSchema) });
	const emailForm = useForm<MFASMSFormData>({ resolver: zodResolver(mfaSmsSchema) });
	const backupForm = useForm<BackupFormData>({ resolver: zodResolver(backupSchema) });

	const handleSubmit = async (code: string, type: CodeMethod) => {
		if (!preAuth) return;
		setSubmitting(true);
		setError('');
		try {
			// 显式方法映射（AUTH-38：backup 不塌缩为 totp；identity 侧 totp/backup 同腿验证）
			const res: any = await verifyMFAChallenge({
				challengeToken: preAuth.challengeToken,
				code,
				mfaMethod: type,
			});
			loginWithTokens(res?.accessToken || '', res?.refreshToken || '', res?.user);
			// AUTH-53 约束⑤：会话建立即锚定租户（tenantId = 登录页写入的权威值；
			// oauth 挑战链无 tenantId → 由 JWT claim 兜底）
			anchorSessionFromToken(res?.accessToken || '', {
				slug: tenantSlug || null,
				tenantId: preAuth.tenantId || null,
				knownTenants,
			});
			sessionStorage.removeItem('mfa_pre_auth');
			navigate(dashboardPath);
		} catch (err) {
			const status = (err as any)?.response?.status;
			const ui = semanticsOfError(err)?.uiObservation;
			// 挑战令牌已失效（服务端复验口径）→ 清会话，引导重新登录。
			// 契约优先；未收录码回落「403」状态判定（保持原行为，不漏判）。
			if (ui === 'reauth_required' || (ui === undefined && status === 403)) {
				sessionStorage.removeItem('mfa_pre_auth');
				setPreAuth(null);
				setFatal('expired');
				return;
			}
			if (ui === 'form_error') {
				setError(t('mfa.challenge.verifyFailed'));
				return;
			}
			if (status === 429) {
				setError(t('mfa.challenge.rateLimited'));
				return;
			}
			setError(extractApiError(err, t('mfa.challenge.verifyFailed')).message);
		} finally {
			setSubmitting(false);
		}
	};

	// 挑战页发送/重发验证码：授权依据是 challenge 令牌内的 mfa_methods。
	const handleSendCode = async (method: 'sms' | 'email') => {
		if (!preAuth || cooldown[method] > 0 || sendingMethod !== '') return;
		setSendingMethod(method);
		setError('');
		setAnnouncement('');
		try {
			await sendMFAChallengeCode({
				challengeToken: preAuth.challengeToken,
				mfaMethod: method,
			});
			setSentMethods((prev) => ({ ...prev, [method]: true }));
			setCooldown((c) => ({ ...c, [method]: RESEND_COOLDOWN_SECONDS }));
			setAnnouncement(t('mfa.challenge.codeSentLive'));
		} catch (err) {
			const status = (err as any)?.response?.status;
			const ui = semanticsOfError(err)?.uiObservation;
			// 挑战令牌失效（与验证同口径：契约优先，未收录码回落 403）
			if (ui === 'reauth_required' || (ui === undefined && status === 403)) {
				sessionStorage.removeItem('mfa_pre_auth');
				setPreAuth(null);
				setFatal('expired');
				return;
			}
			if (status === 429) {
				setError(t('mfa.challenge.rateLimited'));
				return;
			}
			setError(extractApiError(err, t('mfa.challenge.sendFailed')).message);
		} finally {
			setSendingMethod('');
		}
	};

	// 标准 tabs 键盘模型：左右方向键循环切换，Home/End 跳首尾
	const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
		const last = tabs.length - 1;
		let next = -1;
		if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
		else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End') next = last;
		if (next < 0) return;
		event.preventDefault();
		const nextKey = tabs[next];
		setActiveTab(nextKey);
		setError('');
		document.getElementById(`mfa-tab-${nextKey}`)?.focus();
	};

	// 单方法时无标签条，不声明 tabpanel 语义
	const tabPanelProps = (key: CodeMethod) =>
		tabs.length > 1
			? {
					role: 'tabpanel' as const,
					id: `mfa-panel-${key}`,
					'aria-labelledby': `mfa-tab-${key}`,
					tabIndex: 0,
				}
			: {};

	const sendCodeButton = (method: 'sms' | 'email') => (
		<Button
			type="button"
			variant="outline"
			fullWidth
			isLoading={sendingMethod === method}
			disabled={cooldown[method] > 0}
			onClick={() => handleSendCode(method)}
		>
			{cooldown[method] > 0
				? t('common.resendCountdown', { seconds: cooldown[method] })
				: sentMethods[method]
					? t('mfa.challenge.resend')
					: t('mfa.challenge.sendCode')}
		</Button>
	);

	// 验证会话已过期（挂载预检或服务端 403 复验）——引导重新登录
	if (fatal === 'expired') {
		return (
			<AuthCard>
				<div className="text-center space-y-6">
					<div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl">
						⏱️
					</div>
					<AuthHeader
						title={t('mfa.challenge.sessionExpiredTitle')}
						subtitle={t('mfa.challenge.sessionExpiredDesc')}
					/>
					<Button fullWidth onClick={() => navigate(loginPath, { replace: true })}>
						{t('mfa.challenge.sessionExpiredAction')}
					</Button>
				</div>
			</AuthCard>
		);
	}

	// 预检未完成（首帧/跳转中）——不渲染表单
	if (!preAuth) {
		return (
			<AuthCard>
				<div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
					{t('common.loading')}
				</div>
			</AuthCard>
		);
	}

	const tabLabel = (key: CodeMethod) =>
		key === 'totp'
			? t('mfa.challenge.tabTOTP')
			: key === 'sms'
				? t('mfa.challenge.tabSMS')
				: key === 'email'
					? t('mfa.challenge.tabEmail')
					: t('mfa.challenge.tabBackup');

	return (
		<AuthCard>
			<AuthHeader title={t('mfa.challenge.title')} subtitle={t('mfa.challenge.subtitle')} />

			{tabs.length > 1 && (
				<div
					role="tablist"
					aria-label={t('mfa.challenge.methodLabel')}
					className="flex rounded-md bg-[var(--color-bg-muted)] p-1"
				>
					{tabs.map((key, index) => (
						<button
							key={key}
							id={`mfa-tab-${key}`}
							type="button"
							role="tab"
							aria-selected={activeTab === key}
							aria-controls={`mfa-panel-${key}`}
							tabIndex={activeTab === key ? 0 : -1}
							onClick={() => {
								setActiveTab(key);
								setError('');
							}}
							onKeyDown={(event) => handleTabKeyDown(event, index)}
							className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
								activeTab === key
									? 'bg-[var(--color-bg-surface)] text-[var(--color-text-primary)] shadow-card'
									: 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
							}`}
						>
							{tabLabel(key)}
						</button>
					))}
				</div>
			)}

			<div className="sr-only" role="status" aria-live="polite">
				{announcement}
			</div>

			{error && (
				<div role="alert" className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">
					{error}
				</div>
			)}

			{preAuth.riskLevel && (
				<div
					className={`rounded-md p-3 text-sm font-medium ${
						preAuth.riskLevel === 'low'
							? 'bg-brand/10 text-brand-text'
							: preAuth.riskLevel === 'medium'
								? 'bg-warning/10 text-warning-text'
								: 'bg-danger/10 text-danger-text'
					}`}
					data-testid="mfa-risk-level-banner"
				>
					{preAuth.riskLevel === 'low' && t('mfa.riskLevel.low')}
					{preAuth.riskLevel === 'medium' && t('mfa.riskLevel.medium')}
					{preAuth.riskLevel === 'high' && t('mfa.riskLevel.high')}
				</div>
			)}

			{activeTab === 'totp' && (
				<form
					{...tabPanelProps('totp')}
					onSubmit={totpForm.handleSubmit((data) => handleSubmit(data.code, 'totp'))}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="totp-code">{t('mfa.challenge.totpLabel')}</Label>
						<Input
							id="totp-code"
							type="text"
							inputMode="numeric"
							maxLength={6}
							placeholder={t('mfa.challenge.codePlaceholder')}
							autoFocus
							{...totpForm.register('code')}
							error={totpForm.formState.errors.code?.message}
						/>
						<p className="text-xs text-[var(--color-text-secondary)]">
							{t('mfa.challenge.totpHelp')}
						</p>
					</div>
					<Button type="submit" fullWidth isLoading={submitting}>
						{t('mfa.challenge.verify')}
					</Button>
				</form>
			)}

			{activeTab === 'sms' && (
				<form
					{...tabPanelProps('sms')}
					onSubmit={smsForm.handleSubmit((data) => handleSubmit(data.code, 'sms'))}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="sms-code">{t('mfa.challenge.smsLabel')}</Label>
						<Input
							id="sms-code"
							type="text"
							inputMode="numeric"
							maxLength={6}
							placeholder={t('mfa.challenge.codePlaceholder')}
							autoFocus
							{...smsForm.register('code')}
							error={smsForm.formState.errors.code?.message}
						/>
						<p className="text-xs text-[var(--color-text-secondary)]">
							{preAuth.phone
								? t('mfa.challenge.smsDelivered', { target: maskContact(preAuth.phone) })
								: t('mfa.challenge.smsDeliveredGeneric')}
						</p>
					</div>
					{sendCodeButton('sms')}
					<Button type="submit" fullWidth isLoading={submitting}>
						{t('mfa.challenge.verify')}
					</Button>
				</form>
			)}

			{activeTab === 'email' && (
				<form
					{...tabPanelProps('email')}
					onSubmit={emailForm.handleSubmit((data) => handleSubmit(data.code, 'email'))}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="email-code">{t('mfa.challenge.emailLabel')}</Label>
						<Input
							id="email-code"
							type="text"
							inputMode="numeric"
							maxLength={6}
							placeholder={t('mfa.challenge.codePlaceholder')}
							autoFocus
							{...emailForm.register('code')}
							error={emailForm.formState.errors.code?.message}
						/>
						<p className="text-xs text-[var(--color-text-secondary)]">
							{preAuth.email
								? t('mfa.challenge.emailDelivered', { target: maskContact(preAuth.email) })
								: t('mfa.challenge.emailDeliveredGeneric')}
						</p>
					</div>
					{sendCodeButton('email')}
					<Button type="submit" fullWidth isLoading={submitting}>
						{t('mfa.challenge.verify')}
					</Button>
				</form>
			)}

			{activeTab === 'backup' && (
				<form
					{...tabPanelProps('backup')}
					onSubmit={backupForm.handleSubmit((data) => handleSubmit(data.code, 'backup'))}
					className="space-y-4"
				>
					<div className="space-y-2">
						<Label htmlFor="backup-code">{t('mfa.challenge.backupLabel')}</Label>
						<Input
							id="backup-code"
							type="text"
							maxLength={8}
							placeholder={t('mfa.challenge.backupPlaceholder')}
							autoFocus
							{...backupForm.register('code')}
							error={backupForm.formState.errors.code?.message}
						/>
						<p className="text-xs text-[var(--color-text-secondary)]">
							{t('mfa.challenge.backupHelp')}
						</p>
					</div>
					<Button type="submit" fullWidth isLoading={submitting}>
						{t('mfa.challenge.verify')}
					</Button>
				</form>
			)}

			<div className="text-center text-sm">
				<Link to={loginPath} className="text-brand-text hover:underline">
					{t('mfa.challenge.backToLogin')}
				</Link>
			</div>
		</AuthCard>
	);
}
