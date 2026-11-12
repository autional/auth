import { useState } from 'react';
import { Button } from '@autional/ui';
import { AuthCard } from '@/components/auth/AuthCard';
import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { generateRecoveryCodes } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { usePageTitle } from '@/hooks/use-page-title';

/**
 * 恢复码（Recovery Code Phase 3）。
 *
 * 明文只在此页展示一次：生成后立即让用户保存（复制 / 下载）。离开页面或再次生成
 * 都会让旧码失效，服务端只存哈希。
 */
export default function RecoveryCodesPage() {
	const { t } = useI18n();
	usePageTitle('recoveryCodes.title');

	const [codes, setCodes] = useState<string[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
	const [copied, setCopied] = useState(false);

	const handleGenerate = async () => {
		setLoading(true);
		setError('');
		setSaved(false);
		setCopied(false);
		try {
			const res: any = await generateRecoveryCodes();
			const list: string[] = res?.codes ?? res?.data?.codes ?? [];
			setCodes(list);
		} catch (err: any) {
			setError(err?.response?.data?.message || t('recoveryCodes.generateFailed'));
		} finally {
			setLoading(false);
		}
	};

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(codes.join('\n'));
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	const handleDownload = () => {
		try {
			const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = 'autional-recovery-codes.txt';
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			// 下载失败不阻塞：用户仍可复制
		}
	};

	return (
		<AuthCard maxWidth="2xl" align="start" title={t('recoveryCodes.title')} subtitle={t('recoveryCodes.subtitle')}>
			<DashboardNav current="settings" />

			{error && (
				<div className="rounded-md bg-danger/10 p-3 text-sm text-danger-text">{error}</div>
			)}

			{codes.length === 0 ? (
				<div className="space-y-4">
					<p className="text-sm text-[var(--color-text-secondary)]">{t('recoveryCodes.intro')}</p>
					<div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
						{t('recoveryCodes.warning')}
					</div>
					<Button type="button" onClick={handleGenerate} isLoading={loading} fullWidth>
						{t('recoveryCodes.generate')}
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					<p className="text-sm text-[var(--color-text-secondary)]">{t('recoveryCodes.codesHint')}</p>
					<ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
						{codes.map((code) => (
							<li
								key={code}
								className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-bg-muted)] px-3 py-2 font-mono text-sm tracking-wider"
							>
								{code}
							</li>
						))}
					</ul>

					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="outline" onClick={handleCopy}>
							{copied ? t('recoveryCodes.copied') : t('recoveryCodes.copyAll')}
						</Button>
						<Button type="button" variant="outline" onClick={handleDownload}>
							{t('recoveryCodes.download')}
						</Button>
					</div>

					<label className="flex items-start gap-2 text-xs text-[var(--color-text-secondary)]">
						<input
							type="checkbox"
							className="mt-0.5 h-4 w-4"
							checked={saved}
							onChange={(e) => setSaved(e.target.checked)}
						/>
						<span>{t('recoveryCodes.savedConfirm')}</span>
					</label>

					<Button type="button" onClick={() => setCodes([])} disabled={!saved} fullWidth>
						{t('recoveryCodes.done')}
					</Button>

					<Button type="button" variant="outline" onClick={handleGenerate} isLoading={loading} fullWidth>
						{t('recoveryCodes.regenerate')}
					</Button>
				</div>
			)}
		</AuthCard>
	);
}
