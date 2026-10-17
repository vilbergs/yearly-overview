import { execFileSync } from 'node:child_process';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { Planner, TODAY, expect, test } from './fixtures';

// The server holds one planner shared by everything that can reach it, so these tests run one
// at a time and start from an empty planner.
test.describe.configure({ mode: 'serial' });
test.use({ server_sync: true });

type Change = { date: string; entry: { title: string } | null };

async function server_entries(request: APIRequestContext) {
	const response = await request.get('/api/entries');
	return (await response.json()).changes as Change[];
}

async function server_settings(request: APIRequestContext) {
	return (await (await request.get('/api/entries')).json()).settings;
}

test.beforeEach(async ({ request }) => {
	const changes = (await server_entries(request)).map(({ date }) => ({ date, entry: null }));
	const response = await request.put('/api/entries', {
		data: { changes, settings: { categories: {} } }
	});
	expect(response.ok()).toBe(true);
});

/** Sync runs on focus, when coming online and every 30 seconds; tests trigger it directly. */
async function trigger_sync(page: Page) {
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

/** Another device: a separate browser profile pointed at the same server. */
async function second_device(context: BrowserContext) {
	const other = await context.browser()!.newContext({
		locale: 'en-US',
		timezoneId: 'Europe/Stockholm'
	});
	const page = await other.newPage();
	const planner = new Planner(page, true);
	await planner.open();
	await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();
	return { other, page, planner };
}

test.describe('sync with the server', () => {
	test('connects automatically, with no sign-in', async ({ planner, page }) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();
		await expect(page.getByText(/sign in/i)).toHaveCount(0);
	});

	test('edits are saved to the server', async ({ planner, page, request }) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();

		await planner.press('Shift+ArrowDown');
		await planner.type_title('Synced trip');
		await expect
			.poll(() => server_entries(request))
			.toEqual([
				{ date: '2026-10-17', entry: { title: 'Synced trip', description: '' } },
				{ date: '2026-10-18', entry: { title: 'Synced trip', description: '' } }
			]);

		await planner.press('ArrowUp', 'Delete');
		await expect.poll(() => server_entries(request)).toEqual([]);
	});

	test('what was on the device first is merged into the server', async ({ planner, request }) => {
		await request.put('/api/entries', {
			data: { changes: [{ date: '2026-01-01', entry: { title: 'From the server' } }] }
		});

		await planner.open({ entries: { '2026-05-05': { title: 'Made offline', description: '' } } });

		await expect(planner.cell('2026-01-01')).toContainText('From the server');
		await expect(planner.cell('2026-05-05')).toContainText('Made offline');
		await expect
			.poll(async () => (await server_entries(request)).map((change) => change.date))
			.toEqual(['2026-01-01', '2026-05-05']);
	});

	test('two devices see each other’s changes', async ({ planner, page, context, request }) => {
		await planner.open();
		await planner.type_title('From laptop');
		await expect.poll(async () => (await server_entries(request)).length).toBe(1);

		const phone = await second_device(context);
		await expect(phone.planner.cell(TODAY)).toContainText('From laptop');

		await phone.planner.press('ArrowDown');
		await phone.planner.type_title('From phone');
		await expect.poll(async () => (await server_entries(request)).length).toBe(2);

		await trigger_sync(page);
		await expect(planner.cell('2026-10-18')).toContainText('From phone');

		await phone.planner.press('ArrowUp', 'Delete');
		await expect.poll(async () => (await server_entries(request)).length).toBe(1);
		await trigger_sync(page);
		await expect(planner.cell('2026-10-18')).not.toContainText('From phone');

		await phone.other.close();
	});

	test('changes made offline are sent when back online', async ({
		planner,
		page,
		context,
		request
	}) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();

		await context.setOffline(true);
		await planner.type_title('Written offline');
		await expect(page.getByRole('button', { name: /^Sync: Offline \(1 waiting\)/ })).toBeVisible();

		// The API is never answered from the offline cache.
		const status = await page.evaluate(() =>
			fetch('/api/entries').then(
				(response) => response.status,
				() => 'network error'
			)
		);
		expect(status).toBe('network error');

		await context.setOffline(false);
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();
		await expect
			.poll(async () => (await server_entries(request)).map((change) => change.entry?.title))
			.toEqual(['Written offline']);
	});

	test('the sync button and palette sync on demand', async ({ planner, page, request }) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();
		await request.put('/api/entries', {
			data: { changes: [{ date: TODAY, entry: { title: 'Pushed elsewhere' } }] }
		});

		await page.getByRole('button', { name: /^Sync: / }).click();
		await expect(planner.cell(TODAY)).toContainText('Pushed elsewhere');
		await expect(planner.status).toContainText('Synced');

		await request.put('/api/entries', {
			data: { changes: [{ date: TODAY, entry: { title: 'And again' } }] }
		});
		await planner.go_to('sync now');
		await expect(planner.cell(TODAY)).toContainText('And again');
	});

	test('category names and the holiday country sync between devices', async ({
		planner,
		page,
		context,
		request
	}) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();

		await planner.go_to('name categories');
		await page.getByLabel('Name for red').fill('Work');
		await planner.press('ControlOrMeta+Enter');
		await planner.go_to('public holidays');
		await page.getByLabel('Country', { exact: true }).selectOption('SE');
		await page.getByRole('button', { name: 'Save' }).click();

		await expect
			.poll(() => server_settings(request))
			.toEqual({ categories: { red: 'Work' }, holiday_country: 'SE' });

		const phone = await second_device(context);
		await expect(
			phone.page.getByRole('list', { name: 'Categories' }).getByRole('button')
		).toHaveText(['Work']);
		await expect(phone.planner.cell('2026-06-20')).toHaveClass(/holiday/);
		await phone.other.close();
	});

	test('pages on other sites can’t change the planner', async ({ request }) => {
		const response = await request.put('/api/entries', {
			headers: { Origin: 'https://evil.example' },
			data: { changes: [{ date: TODAY, entry: { title: 'Injected' } }] }
		});
		expect(response.status()).toBe(403);
		expect(await server_entries(request)).toEqual([]);
	});

	test('an agent’s MCP tool call shows up in the open planner', async ({
		planner,
		page,
		request
	}) => {
		await planner.open();
		await expect(page.getByRole('button', { name: /^Sync: Synced/ })).toBeVisible();

		const rpc = async (method: string, params: object) =>
			(
				await request.post('/mcp', {
					data: { jsonrpc: '2.0', id: 1, method, params }
				})
			).json();
		const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
		expect(init.result.serverInfo.name).toBe('yearly-overview');

		const added = await rpc('tools/call', {
			name: 'add_event',
			arguments: { start: '2026-10-19', end: '2026-10-21', title: 'Planned by agent' }
		});
		expect(added.result.isError).toBe(false);

		await trigger_sync(page);
		await expect(planner.cell('2026-10-19')).toContainText('Planned by agent');
		await expect(planner.cell('2026-10-21')).toHaveAccessibleName(/Planned by agent/);
	});

	test('the agent skill’s CLI covers every operation', async ({ baseURL, request }) => {
		const cli = (...args: string[]) =>
			JSON.parse(
				execFileSync(
					'python3',
					['-I', '.claude/skills/yearly-overview/scripts/planner.py', ...args],
					{
						env: { ...process.env, YEARLY_OVERVIEW_URL: baseURL },
						encoding: 'utf8'
					}
				)
			);

		expect(cli('settings', '--name', 'green=Holiday').categories).toEqual({ green: 'Holiday' });
		expect(
			cli('add', '2026-07-06', '2026-07-10', '--title', 'Vacation', '-c', 'holiday').event.days
		).toBe(5);
		expect(cli('move', '2026-07-06', '2026-07-10', '2026-07-13').moved[0].start).toBe('2026-07-13');
		expect(cli('update', '2026-07-14', '-d', 'Rest').day.description).toBe('Rest');
		expect(cli('events', '--category', 'Holiday').events).toHaveLength(3);
		expect(cli('today', '--date', '2026-07-01').upcoming[0].title).toBe('Vacation');
		expect(cli('summary', '--year', '2026').planned_days).toBe(5);
		expect(cli('backup').entries['2026-07-13'].title).toBe('Vacation');
		expect(cli('clear', '2026-07-13', '2026-07-17').cleared).toBe(5);
		expect(await server_entries(request)).toEqual([]);
	});
});
