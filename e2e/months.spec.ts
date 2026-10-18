import { TODAY, expect, test } from './fixtures';

test.describe('hiding months', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
	});

	test('a month hides from its header and comes back from its strip', async ({ planner, page }) => {
		await page.getByRole('button', { name: 'Hide January' }).click();
		await expect(planner.cell('2026-01-15')).toHaveCount(0);
		await expect(planner.status).toContainText('January hidden');
		await planner.expect_focus(TODAY);

		await page.getByRole('button', { name: 'Show January' }).click();
		await expect(planner.cell('2026-01-15')).toBeVisible();
	});

	test('arrow keys and Ctrl+Home skip hidden months', async ({ planner }) => {
		await planner.go_to('hide past months');
		await expect(planner.cell('2026-09-30')).toHaveCount(0);
		await planner.expect_focus(TODAY);

		await planner.press('ArrowLeft');
		await planner.expect_focus(TODAY);
		await planner.press('ControlOrMeta+Home');
		await planner.expect_focus('2026-10-01');
	});

	test('hiding the month with the cursor moves it to the next shown month', async ({ planner }) => {
		await planner.go_to('hide october');
		await expect(planner.cell(TODAY)).toHaveCount(0);
		await planner.expect_focus('2026-11-17');
	});

	test('going to a date in a hidden month shows it again', async ({ planner }) => {
		await planner.go_to('hide past months');
		await planner.go_to('14 mar');
		await planner.expect_focus('2026-03-14');
		await expect(planner.cell('2026-02-01')).toHaveCount(0);
	});

	test('hidden months are per year and survive a reload', async ({ planner, page }) => {
		await page.getByRole('button', { name: 'Hide February' }).click();
		await planner.press('PageDown');
		await expect(planner.cell('2027-02-01')).toBeVisible();
		await planner.press('PageUp');
		await expect(planner.cell('2026-02-01')).toHaveCount(0);

		await page.reload();
		await expect(planner.cell('2026-02-01')).toHaveCount(0);
		await planner.go_to('show february');
		await expect(planner.cell('2026-02-01')).toBeVisible();
	});

	test('the last shown month cannot be hidden', async ({ planner, page }) => {
		for (const month of ['January', 'February', 'March', 'April', 'May', 'June']) {
			await page.getByRole('button', { name: `Hide ${month}` }).click();
		}
		for (const month of ['July', 'August', 'September', 'November', 'December']) {
			await page.getByRole('button', { name: `Hide ${month}` }).click();
		}
		await expect(page.getByRole('button', { name: 'Hide October' })).toHaveCount(0);
		await planner.go_to('show all months');
		await expect(planner.cell('2026-01-01')).toBeVisible();
		await expect(planner.cell('2026-12-31')).toBeVisible();
	});
});
