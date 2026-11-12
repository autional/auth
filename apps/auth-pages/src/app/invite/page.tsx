'use client';

/**
 * /invite/:token —— 邀请深链落地页。
 *
 * 职责刻意做薄：只解析 token、调一次预览接口，然后把用户送到真正的注册页
 * （`/:tenantSlug/register?invitation_code=<token>`），表单与提交逻辑保持单一实现。
 *
 * 背景：tenant-service 生成的 invite_link 是根相对路径 `/invite/{token}`（ADR-3 v2），
 * 本页就是它的落点；此前该路径 404。
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { AuthCard } from '@/components/auth/AuthCard';
import { previewInvitation } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type InvitePreview = {
	valid?: boolean;
	tenantSlug?: string;
	tenantName?: string;
};

export default function InvitePage() {
	const { token } = useParams<{ token: string }>();
	const navigate = useNavigate();
	const { t } = useI18n();
	const [invalid, setInvalid] = useState(false);

	useEffect(() => {
		let cancelled = false;
		if (!token) {
			setInvalid(true);
			return;
		}
		previewInvitation(token)
			.then((raw) => {
				if (cancelled) return;
				const data = (raw ?? {}) as InvitePreview;
				if (!data.valid || !data.tenantSlug) {
					setInvalid(true);
					return;
				}
				navigate(`/${encodeURIComponent(data.tenantSlug)}/register?invitation_code=${encodeURIComponent(token)}`, {
					replace: true,
				});
			})
			.catch(() => {
				if (!cancelled) setInvalid(true);
			});
		return () => {
			cancelled = true;
		};
	}, [token, navigate]);

	return (
		<AuthCard>
			<div className="space-y-2 text-center">
				<p className="text-sm text-neutral-600">
					{invalid ? t('register.inviteInvalid') : t('register.inviteResolving')}
				</p>
			</div>
		</AuthCard>
	);
}
