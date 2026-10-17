import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const CI = !!process.env.CI;

/**
 * End-to-end tests run against the real Rust server, which also serves the built frontend.
 * Run `npm run build` first (`npm run test:e2e` does both).
 */
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: CI,
	retries: CI ? 1 : 0,
	workers: CI ? 2 : undefined,
	reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: BASE_URL,
		locale: 'en-US',
		timezoneId: 'Europe/Stockholm',
		permissions: ['clipboard-read', 'clipboard-write'],
		trace: 'retain-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } }
		}
	],
	webServer: {
		// A fresh PostgreSQL database for every run (see the script for connection settings).
		command: 'scripts/e2e-server.sh',
		url: `${BASE_URL}/api/health`,
		reuseExistingServer: !CI,
		timeout: 600_000,
		stdout: 'ignore',
		stderr: 'pipe',
		env: {
			PORT: String(PORT),
			BIND_ADDR: `127.0.0.1:${PORT}`,
			STATIC_DIR: 'build',
			RUST_LOG: 'warn'
		}
	}
});
