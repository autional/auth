import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { BareToTenantRedirect } from '../BareToTenantRedirect';

const { mockUseEffectiveTenantSlug } = vi.hoisted(() => ({
	mockUseEffectiveTenantSlug: vi.fn(),
}));

vi.mock('@/hooks/use-tenant-slug', () => ({
	useEffectiveTenantSlug: () => mockUseEffectiveTenantSlug(),
}));

function LocationProbe() {
	const { pathname, search } = useLocation();
	return <div data-testid="location">{`${pathname}${search}`}</div>;
}

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<LocationProbe />
			<Routes>
				<Route
					path="/mfa-setup"
					element={
						<BareToTenantRedirect>
							<div>bare-mfa-setup-fallback</div>
						</BareToTenantRedirect>
					}
				/>
				<Route
					path="/account/recovery-codes"
					element={
						<BareToTenantRedirect to="/recovery-codes">
							<div>bare-recovery-codes-fallback</div>
						</BareToTenantRedirect>
					}
				/>
				<Route path="/:tenantSlug/mfa-setup" element={<div>slug-mfa-setup</div>} />
				<Route path="/:tenantSlug/recovery-codes" element={<div>slug-recovery-codes</div>} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('BareToTenantRedirect', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('可解析租户：/mfa-setup → /<slug>/mfa-setup', () => {
		mockUseEffectiveTenantSlug.mockReturnValue('acme-corp');
		renderAt('/mfa-setup');
		expect(screen.getByText('slug-mfa-setup')).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/acme-corp/mfa-setup');
	});

	it('无租户上下文：渲染 children（不重定向）', () => {
		mockUseEffectiveTenantSlug.mockReturnValue(undefined);
		renderAt('/mfa-setup');
		expect(screen.getByText('bare-mfa-setup-fallback')).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/mfa-setup');
	});

	it('to 覆盖生效：/account/recovery-codes → /<slug>/recovery-codes', () => {
		mockUseEffectiveTenantSlug.mockReturnValue('acme-corp');
		renderAt('/account/recovery-codes');
		expect(screen.getByText('slug-recovery-codes')).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveTextContent('/acme-corp/recovery-codes');
	});
});
