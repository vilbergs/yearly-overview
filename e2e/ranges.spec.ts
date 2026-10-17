import { expect, test } from './fixtures';

const days = (from: number, to: number, month = '07') =>
	Array.from(
		{ length: to - from + 1 },
		(_, i) => `2026-${month}-${String(from + i).padStart(2, '0')}`
	);

test.describe('ranges and multi-day blocks', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
		await planner.go_to('6 jul');
	});

	test('Shift+arrows select a range and typing fills it', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown');
		await expect(planner.status).toContainText('5 days');
		await planner.type_title('Vacation');

		const entries = await planner.entries();
		for (const key of days(6, 10)) expect(entries[key]?.title).toBe('Vacation');
		expect(entries['2026-07-11']).toBeUndefined();
		// Enter leaves the block downwards.
		await planner.expect_focus('2026-07-11');
	});

	test('a block shows its title once', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await expect(planner.cell('2026-07-06').locator('.title')).toHaveText('Trip');
		await expect(planner.cell('2026-07-07').locator('.title')).toHaveText('');
		await expect(planner.cell('2026-07-07')).toHaveClass(/continues/);
		// The accessible name still tells screen readers what the day holds.
		await expect(planner.cell('2026-07-07')).toHaveAccessibleName(/Trip/);
	});

	test('blocks span month boundaries', async ({ planner }) => {
		await planner.go_to('30 jun');
		await planner.press('Shift+ArrowRight');
		await expect(planner.status).toContainText('31 days');
		await planner.press('Escape');
		await expect(planner.status).not.toContainText('31 days');
	});

	test('color, details and delete apply to the whole block under the cursor', async ({
		planner,
		page
	}) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await planner.press('ArrowUp');

		await planner.press('Alt+Digit4');
		let entries = await planner.entries();
		for (const key of days(6, 9)) expect(entries[key]?.color).toBe('green');

		await planner.press('Shift+Enter');
		await expect(page.getByRole('dialog')).toContainText('4 days');
		await page.getByLabel('Description').fill('Cabin by the lake');
		await page.getByRole('button', { name: /Save/ }).click();
		entries = await planner.entries();
		for (const key of days(6, 9)) expect(entries[key]?.description).toBe('Cabin by the lake');

		await planner.press('Delete');
		entries = await planner.entries();
		for (const key of days(6, 9)) expect(entries[key]).toBeUndefined();
		await expect(planner.status).toContainText('Cleared 4 days');
	});

	test('renaming a block renames every day of it', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await planner.press('ArrowUp', 'ArrowUp');
		await planner.type_title('Road trip');
		const entries = await planner.entries();
		for (const key of days(6, 8)) expect(entries[key]?.title).toBe('Road trip');
	});

	test('selecting part of a block changes only those days', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await planner.press('ArrowUp', 'Shift+ArrowUp');
		await planner.press('Delete');
		const entries = await planner.entries();
		expect(entries['2026-07-06']?.title).toBe('Trip');
		expect(entries['2026-07-07']?.title).toBe('Trip');
		expect(entries['2026-07-08']).toBeUndefined();
		expect(entries['2026-07-09']).toBeUndefined();
	});

	test('Shift+End selects to the end of the month', async ({ planner }) => {
		await planner.go_to('25 jul');
		await planner.press('Shift+End');
		await expect(planner.status).toContainText('7 days');
	});

	test('dragging with the mouse selects a range', async ({ planner, page }) => {
		await planner.cell('2026-09-14').hover();
		await page.mouse.down();
		await planner.cell('2026-09-18').hover();
		await page.mouse.up();
		await expect(planner.status).toContainText('5 days');
		await planner.type_title('Conference');
		const entries = await planner.entries();
		for (const key of days(14, 18, '09')) expect(entries[key]?.title).toBe('Conference');
	});

	test('Shift+click extends the selection', async ({ planner, page }) => {
		await planner.cell('2026-07-20').click({ modifiers: ['Shift'] });
		await expect(planner.status).toContainText('15 days');
		await page.keyboard.press('Alt+Digit1');
		expect((await planner.entry('2026-07-13'))?.color).toBe('red');
	});
});
