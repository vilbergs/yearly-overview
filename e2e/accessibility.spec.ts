import AxeBuilder from '@axe-core/playwright';
import { TODAY, expect, test } from './fixtures';

const scan = (page: import('@playwright/test').Page) =>
	new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

test.describe('accessibility', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: {
				'2026-10-17': { title: 'Dentist', description: '9am', color: 'orange' },
				'2026-07-06': { title: 'Vacation', description: '', color: 'green' },
				'2026-07-07': { title: 'Vacation', description: '', color: 'green' }
			}
		});
	});

	test('the calendar has no WCAG A/AA violations', async ({ page }) => {
		const { violations } = await scan(page);
		expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
	});

	test('dark mode has no WCAG A/AA violations', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark' });
		const { violations } = await scan(page);
		expect(violations.map((v) => `${v.id}: ${v.nodes.length} × ${v.help}`)).toEqual([]);
	});

	for (const [name, open] of [
		['details', 'Shift+Enter'],
		['palette', 'ControlOrMeta+k'],
		['shortcuts', 'ControlOrMeta+/']
	] as const) {
		test(`the ${name} dialog has no WCAG A/AA violations`, async ({ page }) => {
			await page.keyboard.press(open);
			await expect(page.locator('dialog[open]')).toBeVisible();
			const { violations } = await new AxeBuilder({ page })
				.include('dialog[open]')
				.withTags(['wcag2a', 'wcag2aa'])
				.analyze();
			expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
		});
	}

	test('days have descriptive labels', async ({ planner }) => {
		await expect(planner.cell(TODAY)).toHaveAccessibleName(
			'Saturday, October 17, 2026, week 42, Dentist, Orange'
		);
		await expect(planner.cell('2026-10-18')).toHaveAccessibleName(
			'Sunday, October 18, 2026, week 42'
		);
	});

	test('only one day is in the tab order', async ({ page }) => {
		await expect(page.locator('[data-key][tabindex="0"]')).toHaveCount(1);
	});

	test('status messages are announced', async ({ planner, page }) => {
		await planner.press('Delete');
		await expect(page.getByRole('status')).toContainText('Cleared');
	});
});

test.describe('small screens', () => {
	test.use({ viewport: { width: 390, height: 800 } });

	test('the page does not scroll sideways; the calendar does', async ({ planner, page }) => {
		await planner.open();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await expect(planner.cell(TODAY)).toBeInViewport();
	});
});
