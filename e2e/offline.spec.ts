import { TODAY, expect, test } from './fixtures';

test.describe('installable, offline-capable app', () => {
	test('loads without a connection after the first visit', async ({ planner, page, context }) => {
		await planner.open();
		await planner.type_title('Written online');
		await page.evaluate(() => navigator.serviceWorker.ready);

		await context.setOffline(true);
		await page.reload();
		await expect(planner.cell(TODAY)).toBeFocused();
		await expect(planner.cell(TODAY)).toContainText('Written online');

		// Editing still works offline.
		await planner.press('ArrowDown');
		await planner.type_title('Written offline');
		expect((await planner.entry('2026-10-18'))?.title).toBe('Written offline');
		await context.setOffline(false);
	});

	test('has a web app manifest with installable icons', async ({ page }) => {
		const response = await page.request.get('/manifest.webmanifest');
		expect(response.ok()).toBe(true);
		const manifest = await response.json();
		expect(manifest.display).toBe('standalone');
		for (const size of ['192x192', '512x512']) {
			const icon = manifest.icons.find((icon: { sizes: string }) => icon.sizes === size);
			expect((await page.request.get(icon.src)).ok()).toBe(true);
		}
	});

	test('large on-demand data is cached only once used', async ({ planner, page, context }) => {
		await planner.open();
		await page.evaluate(() => navigator.serviceWorker.ready);
		const cached = () =>
			page.evaluate(async () => {
				const keys = await caches.keys();
				const cache = await caches.open(keys[0]);
				return (await cache.keys()).length;
			});
		const before = await cached();

		// Turning on holidays downloads the holiday data, which is then kept for offline use.
		await page.evaluate(() =>
			localStorage.setItem(
				'yearly-overview:settings:v1',
				JSON.stringify({ categories: {}, holiday_country: 'SE' })
			)
		);
		await page.reload();
		await expect(planner.cell('2026-06-20')).toHaveClass(/holiday/);
		await expect.poll(cached).toBeGreaterThan(before);

		await context.setOffline(true);
		await page.reload();
		await expect(planner.cell('2026-06-20')).toHaveClass(/holiday/);
		await context.setOffline(false);
	});
});
