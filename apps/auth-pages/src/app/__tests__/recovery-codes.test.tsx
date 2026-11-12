import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import RecoveryCodesPage from '../recovery-codes/page';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: 'en-US', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

vi.mock('react-router', async () => {
	const actual = await vi.importActual('react-router');
	return { ...actual, Link: ({ to, children }: any) => <a href={to}>{children}</a> };
});

vi.mock('@/components/dashboard/DashboardNav', () => ({
	DashboardNav: () => null,
}));

const mockGenerate = vi.fn();
vi.mock('@/lib/api', () => ({
	generateRecoveryCodes: (...args: any[]) => mockGenerate(...args),
}));

describe('RecoveryCodesPage', () => {
	beforeEach(() => {
		mockGenerate.mockReset();
		mockGenerate.mockResolvedValue({ codes: ['AAAA-BBBBBB', 'CCCC-DDDDDD'] });
	});

	it('shows the generate CTA and one-time warning before generating', () => {
		render(
			<MemoryRouter>
				<RecoveryCodesPage />
			</MemoryRouter>,
		);
		expect(screen.getByText('recoveryCodes.warning')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'recoveryCodes.generate' })).toBeTruthy();
	});

	it('renders the generated codes once and requires an explicit save confirmation', async () => {
		render(
			<MemoryRouter>
				<RecoveryCodesPage />
			</MemoryRouter>,
		);

		fireEvent.click(screen.getByRole('button', { name: 'recoveryCodes.generate' }));

		await waitFor(() => expect(mockGenerate).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(screen.getByText('AAAA-BBBBBB')).toBeTruthy());
		expect(screen.getByText('CCCC-DDDDDD')).toBeTruthy();

		const done = screen.getByRole('button', { name: 'recoveryCodes.done' }) as HTMLButtonElement;
		expect(done.disabled).toBe(true);

		fireEvent.click(screen.getByRole('checkbox'));
		expect(done.disabled).toBe(false);
	});
});
