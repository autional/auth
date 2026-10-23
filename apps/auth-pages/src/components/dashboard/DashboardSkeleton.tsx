'use client';

import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';

/**
 * 登录后页骨架屏。
 *
 * 为什么不复用整屏 `LoadingScreen`：整屏 spinner 会在数据到达时把「无」直接换成
 * 「有」，首屏所有元素同时位移（web.dev CLS：空元素 0px 是最差情况）。骨架屏沿用
 * 同一外壳与同一网格尺寸，数据到达只替换占位块，外壳与导航条不动。
 */
export function DashboardSkeleton({
	current,
	message,
}: {
	current: 'overview' | 'account';
	message: string;
}) {
	const pulse = 'animate-pulse rounded-xs bg-[var(--color-bg-muted)]';

	return (
		<AuthCard maxWidth="2xl" align="start">
			<DashboardNav current={current} />
			{/* 读屏与「加载中」状态锚点（视觉上由骨架表达，不额外占位） */}
			<p className="sr-only" role="status" aria-live="polite">
				{message}
			</p>

			<div className="space-y-3">
				<div className={`h-7 w-40 ${pulse}`} />
				<div className={`h-4 w-56 max-w-full ${pulse}`} />
			</div>

			<div className="space-y-3">
				<div className={`h-4 w-24 ${pulse}`} />
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="h-[104px] animate-pulse rounded-md bg-[var(--color-bg-muted)]" />
					))}
				</div>
			</div>

			<div className="space-y-2">
				<div className={`h-4 w-24 ${pulse}`} />
				<div className={`h-5 w-full max-w-sm ${pulse}`} />
			</div>
		</AuthCard>
	);
}

export default DashboardSkeleton;
