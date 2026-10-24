/**
 * 租户显式透传包装（WS-G / AUTH-01/02/04）。
 *
 * 背景：后端公开认证端点已改为「显式租户优先」（body tenant_id > query > X-Tenant-ID，
 * 空即 400），但本地安装的 `@autional/shared@0.1.0-rc.42` 生成类型尚未携带
 * `tenantId`。生成物是 DO NOT EDIT（AC-G7），本模块只做类型放宽并在调用边界补字段。
 *
 * 约定：
 * - 调用方一律用 camelCase 书面写键；`apiClient` 拦截器统一转 snake_case。
 * - `tenantId` 为空时不下发该字段（不发明空租户，交后端 400 tenant_required）。
 * - 禁止在此从 localStorage/默认租户兜底：租户来源由页面按 WS-G G2 表决定。
 */
import * as GeneratedApi from '@autional/shared/generated/api';

type Payload = Record<string, unknown>;

/** 生成函数签名未含 tenantId —— `as any` 只出现在本模块的调用边界。 */
function call(fn: (data: any) => Promise<any>, data: Payload): Promise<any> {
	return fn(data as any);
}

function withTenant(data: Payload, tenantId?: string): Payload {
	return tenantId ? { ...data, tenantId } : data;
}

/** 注册响应面（WS-A/R3 M-7）：pending 时不携带 token，前端据此走待审页。 */
export interface RegisterOutcome {
	userId?: string;
	status?: string;
	membershipStatus?: string;
	message?: string;
}

export const registerAccount = (data: Payload): Promise<RegisterOutcome> =>
	call(GeneratedApi.authRegisterPost, data) as Promise<RegisterOutcome>;

export const checkEmailAvailability = (email: string, tenantId?: string) =>
	call(GeneratedApi.authRegisterCheckEmailPost, withTenant({ email }, tenantId));

export const sendVerificationEmail = (email: string, tenantId?: string) =>
	call(GeneratedApi.authSendVerificationEmailPost, withTenant({ email }, tenantId));

export const sendLoginSmsCode = (phone: string, tenantId?: string) =>
	call(GeneratedApi.authSendSmsCodePost, withTenant({ phone }, tenantId));

export const forgotPassword = (identity: string, tenantId?: string) =>
	call(GeneratedApi.authForgotPasswordPost, withTenant({ identity }, tenantId));

export const verifyResetCode = (identity: string, code: string, tenantId?: string) =>
	call(GeneratedApi.authVerifyResetCodePost, withTenant({ identity, code }, tenantId));

export const resetPassword = (data: {
	identity: string;
	code: string;
	newPassword: string;
	passwordTransmission?: string;
	tenantId?: string;
}) => call(GeneratedApi.authResetPasswordPost, data as Payload);

export const verifyEmailAddress = (email: string, code: string, tenantId?: string) =>
	call(GeneratedApi.authVerifyEmailPost, withTenant({ email, code }, tenantId));

export const resendVerificationEmail = (email: string, tenantId?: string) =>
	call(GeneratedApi.authResendVerificationEmailPost, withTenant({ email }, tenantId));

export const verifyPhoneNumber = (phone: string, code: string, tenantId?: string) =>
	call(GeneratedApi.authVerifyPhonePost, withTenant({ phone, code }, tenantId));

export const requestAccountRecovery = (identity: string, tenantId?: string) =>
	call(GeneratedApi.authRecoverAccountPost, withTenant({ identity }, tenantId));

export const resetAccountRecovery = (data: {
	identity: string;
	code: string;
	newPassword: string;
	passwordTransmission?: string;
	tenantId?: string;
}) => call(GeneratedApi.authRecoverAccountResetPost, data as Payload);
