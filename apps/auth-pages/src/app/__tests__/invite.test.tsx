import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import InvitePage from '../invite/page';

vi.mock('react-i18next', () => ({
	useTranslation: () => ({
		t: (key: string) => key,
		i18n: { language: 'en-US', changeLanguage: vi.fn() },
	}),
	I18nextProvider: ({ children }: any) => children,
}));

vi.mock('@/lib/i18n', () => ({
	useI18n: () => ({ t: (key: string) => key }),
}));

const mockPreview = vi.fn();
vi.mock('@/lib/api', () => ({
	previewInvitation: (...args: any[]) => mockPreview(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
	const actual = await vi.importActual<typeof import('react-router')>('react-router');
	return {
		...actual,
		useNavigate: () => mockNavigate,
	};
});

function renderAt(path: string) {
	return render(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="/invite/:token" element={<InvitePage />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe('InvitePage', () => {
	beforeEach(() => {
		mockPreview.mockReset();
		mockNavigate.mockReset();
	});

	it('valid token → redirects to tenant register page with prefilled invitation code', async () => {
		mockPreview.mockResolvedValue({ valid: true, tenantSlug: 'acme', tenantName: 'ACME Corporation' });

		renderAt('/invite/TOKEN-1');

		await waitFor(() => expect(mockPreview).toHaveBeenCalledWith('TOKEN-1'));
		await waitFor(() =>
			expect(mockNavigate).toHaveBeenCalledWith('/acme/register?invitation_code=TOKEN-1', { replace: true }),
		);
	});

	it('invalid token → shows expired notice and does not navigate', async () => {
		mockPreview.mockResolvedValue({ valid: false });

		renderAt('/invite/BAD');

		await waitFor(() => expect(screen.getByText('register.inviteInvalid')).toBeTruthy());
		expect(mockNavigate).not.toHaveBeenCalled();
	});
});
