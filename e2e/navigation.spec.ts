import { TODAY, expect, test } from './fixtures';

test.describe('keyboard navigation', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
	});

	test('starts on today with the calendar focused', async ({ planner, page }) => {
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026');
		await expect(planner.cell(TODAY)).toHaveAttribute('aria-current', 'date');
		await expect(planner.status).toContainText('Saturday, October 17, 2026');
		await expect(planner.status).toContainText('Week 42');
	});

	test('arrow keys move by day and by month', async ({ planner }) => {
		await planner.press('ArrowDown');
		await planner.expect_focus('2026-10-18');
		await planner.press('ArrowUp', 'ArrowUp');
		await planner.expect_focus('2026-10-16');
		await planner.press('ArrowRight');
		await planner.expect_focus('2026-11-16');
		await planner.press('ArrowLeft', 'ArrowLeft');
		await planner.expect_focus('2026-09-16');
	});

	test('moving into a shorter month clamps the day', async ({ planner }) => {
		await planner.go_to('31 jan');
		await planner.press('ArrowRight');
		await planner.expect_focus('2026-02-28');
	});

	test('stops at the edges of a month and the year', async ({ planner }) => {
		await planner.go_to('1 jan');
		await planner.press('ArrowUp', 'ArrowLeft');
		await planner.expect_focus('2026-01-01');
		await planner.go_to('31 dec');
		await planner.press('ArrowDown', 'ArrowRight');
		await planner.expect_focus('2026-12-31');
	});

	test('Home and End jump within the month or year', async ({ planner }) => {
		await planner.press('Home');
		await planner.expect_focus('2026-10-01');
		await planner.press('End');
		await planner.expect_focus('2026-10-31');
		await planner.press('ControlOrMeta+Home');
		await planner.expect_focus('2026-01-01');
		await planner.press('ControlOrMeta+End');
		await planner.expect_focus('2026-12-31');
	});

	test('Page Up and Page Down change the year', async ({ planner, page }) => {
		await planner.press('PageDown');
		await planner.expect_focus('2027-10-17');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2027');
		await expect(page).toHaveTitle('2027 · Yearly Overview');
		await planner.press('PageUp', 'PageUp');
		await planner.expect_focus('2025-10-17');
	});

	test('29 February maps to the 28th in a non-leap year', async ({ planner }) => {
		await planner.go_to('2028-02-29');
		await planner.press('PageUp');
		await planner.expect_focus('2027-02-28');
	});

	test('toolbar buttons change year and return to today', async ({ planner, page }) => {
		await page.getByRole('button', { name: 'Next year' }).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2027');
		await page.getByRole('button', { name: 'Today' }).click();
		await planner.expect_focus(TODAY);
	});

	test('keys pressed with nothing focused go back to the calendar', async ({ planner, page }) => {
		await page.evaluate(() => (document.activeElement as HTMLElement).blur());
		await planner.press('ArrowDown');
		await planner.expect_focus(TODAY);
	});

	test('Tab leaves the calendar and comes back to the same day', async ({ planner, page }) => {
		await planner.press('ArrowDown');
		await planner.press('Shift+Tab');
		// The last toolbar control comes right before the calendar.
		await expect(page.getByText('More', { exact: true })).toBeFocused();
		await planner.press('Tab');
		await planner.expect_focus('2026-10-18');
	});
});
