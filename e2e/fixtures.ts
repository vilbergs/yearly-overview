import { test as base, expect, type Locator, type Page } from '@playwright/test';

/** Every test runs on the same day so dates in assertions are stable. */
export const TODAY = '2026-10-17';

const STORAGE_KEY = 'yearly-overview:entries:v1';

type Entry = { title: string; description: string; color?: string };

export class Planner {
	/**
	 * `server_sync`: talk to the real sync server. All tests share its one planner, so only the
	 * serial sync suite does; everywhere else the API answers 404, like a static host.
	 */
	constructor(
		readonly page: Page,
		readonly server_sync = false
	) {}

	async open(options: { entries?: Record<string, Entry> } = {}) {
		await this.page.clock.setFixedTime(new Date(`${TODAY}T10:00:00`));
		if (!this.server_sync) {
			await this.page.route('**/api/**', (route) =>
				route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
			);
		}
		if (options.entries) {
			await this.page.addInitScript(
				([key, value]) => {
					// Only seed once, so reloads keep what the test changed.
					if (!sessionStorage.getItem('seeded')) {
						localStorage.setItem(key, value);
						sessionStorage.setItem('seeded', '1');
					}
				},
				[STORAGE_KEY, JSON.stringify(options.entries)]
			);
		}
		await this.page.goto('/');
		await expect(this.cell(TODAY)).toBeFocused();
	}

	cell(key: string): Locator {
		return this.page.locator(`[data-key="${key}"]`);
	}

	get editor(): Locator {
		return this.page.locator('.inline-editor');
	}

	get status(): Locator {
		return this.page.locator('footer.status');
	}

	async expect_focus(key: string) {
		await expect(this.cell(key)).toBeFocused();
	}

	async press(...keys: string[]) {
		for (const key of keys) await this.page.keyboard.press(key);
	}

	/** Types into the focused day and saves with Enter. */
	async type_title(text: string, commit = 'Enter') {
		await this.page.keyboard.type(text);
		await this.page.keyboard.press(commit);
	}

	async go_to(query: string) {
		await this.press('ControlOrMeta+k');
		await this.page.getByRole('combobox').fill(query);
		await this.press('Enter');
	}

	async entries(): Promise<Record<string, Entry>> {
		return this.page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}'), STORAGE_KEY);
	}

	async entry(key: string) {
		return (await this.entries())[key];
	}
}

type Fixtures = { planner: Planner; console_errors: string[]; server_sync: boolean };

export const test = base.extend<Fixtures>({
	// Fails any test that logs an error to the console.
	console_errors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(String(error)));
			page.on('console', (message) => {
				// The browser logs every failed request (the blocked API, offline tests, ...); those
				// are expected, and unexpected ones fail the test's own assertions.
				if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
					errors.push(message.text());
				}
			});
			await use(errors);
			expect(errors, 'console errors').toEqual([]);
		},
		{ auto: true }
	],
	server_sync: [false, { option: true }],
	planner: async ({ page, server_sync }, use) => {
		await use(new Planner(page, server_sync));
	}
});

export { expect };
