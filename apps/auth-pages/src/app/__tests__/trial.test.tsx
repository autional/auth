import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import TrialPage from '../trial/page';

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

vi.mock('@/lib/legal-document', () => ({
	fetchLegalDocumentVersion: vi.fn(async () => '2026-11-01'),
}));

const mockPost = vi.fn();
vi.mock('@autional/shared/generated/api', async (importOriginal) => ({
	...(await importOriginal<typeof import('@autional/shared/generated/api')>()),
	tenantPublicTenantsPost: (...args: any[]) => mockPost(...args),
}));

function renderPage() {
	return render(
		<MemoryRouter>
			<TrialPage />
		</MemoryRouter>,
	);
}

describe('TrialPage', () => {
	beforeEach(() => {
		mockPost.mockReset();
		mockPost.mockResolvedValue({ name: 'acme-trial' });
	});

	it('renders the trial form fields', () => {
		renderPage();
		expect(screen.getByLabelText('auth.trial.name')).toBeTruthy();
		expect(screen.getByLabelText('auth.trial.adminEmail')).toBeTruthy();
		expect(screen.getByLabelText('auth.trial.adminPassword')).toBeTruthy();
	});

	it('submits the public trial tenant endpoint and shows the created workspace', async () => {
		renderPage();

		fireEvent.change(screen.getByLabelText('auth.trial.name'), { target: { value: 'acme-trial' } });
		fireEvent.change(screen.getByLabelText('auth.trial.adminEmail'), {
			target: { value: 'owner@acme.test' },
		});
		fireEvent.change(screen.getByLabelText('auth.trial.adminPassword'), {
			target: { value: 'Password123!' },
		});
		fireEvent.click(screen.getByLabelText(/auth\.trial\.agreePrefix/));

		fireEvent.click(screen.getByRole('button', { name: 'auth.trial.submit' }));

		await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
		const payload = mockPost.mock.calls[0][0];
		expect(payload.name).toBe('acme-trial');
		expect(payload.adminEmail).toBe('owner@acme.test');
		expect(payload.agreementAccepted).toBe(true);
		expect(payload.agreementVersion).toBe('2026-11-01');

		await waitFor(() => expect(screen.getByText('acme-trial')).toBeTruthy());
	});
});
