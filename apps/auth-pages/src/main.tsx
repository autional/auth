import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ROUTER_BASENAME, isRetryableError } from '@autional/shared';
import App from './App';
import './non-tenant-segments';
import './app/globals.css';

const queryClient = new QueryClient({
	defaultOptions: {
		// 重试策略唯一实现（@autional/shared/utils/query-state 的 isRetryableError）：4xx 不重试。
		queries: { retry: (failureCount, error) => isRetryableError(error) && failureCount < 1, staleTime: 30000 },
	},
});

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<BrowserRouter basename={ROUTER_BASENAME}>
					<App />
				</BrowserRouter>
			</QueryClientProvider>
		</StrictMode>,
	);
}
