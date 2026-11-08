import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { BareActivityRedirect } from '../BareActivityRedirect';

const { mockUseEffectiveTenantSlug } = vi.hoisted(() => ({
	mockUseEffectiveTenantSlug: vi.fn(),
}));

vi.mock('@/hooks/use-tenant-slug', () => ({
	useEffectiveTenantSlug: () => mockUseEffectiveTenantSlug(),
}));

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route
					path="/activity"
					element={
						<BareActivityRedirect>
							<div>bare-activity-fallback</div>
						</BareActivityRedirect>
					}
				/>
				<Route
					path="/security"
					element={
						<BareActivityRedirect>
							<div>bare-security-fallback</div>
						</BareActivityRedirect>
					}
				/>
				<Route path="/:tenantSlug/activity" element={<div>slug-activity</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('BareActivityRedirect', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('已登录可解析租户：/activity → /<slug>/activity', () => {
		mockUseEffectiveTenantSlug.mockReturnValue('acme-corp');
		renderAt('/activity');
		expect(screen.getByText('slug-activity')).toBeInTheDocument();
	});

	it('已登录可解析租户：/security → /<slug>/activity', () => {
		mockUseEffectiveTenantSlug.mockReturnValue('acme-corp');
		renderAt('/security');
		expect(screen.getByText('slug-activity')).toBeInTheDocument();
	});

	it('无租户上下文：/activity 保持原渲染', () => {
		mockUseEffectiveTenantSlug.mockReturnValue(undefined);
		renderAt('/activity');
		expect(screen.getByText('bare-activity-fallback')).toBeInTheDocument();
	});

	it('无租户上下文：/security 保持原渲染', () => {
		mockUseEffectiveTenantSlug.mockReturnValue(undefined);
		renderAt('/security');
		expect(screen.getByText('bare-security-fallback')).toBeInTheDocument();
	});
});
