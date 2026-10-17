import { TODAY, expect, test } from './fixtures';

test.describe('undo and redo', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
	});

	test('undo and redo edits, and jump back to them', async ({ planner }) => {
		await planner.type_title('First');
		await planner.type_title('Second');
		await planner.press('ControlOrMeta+z');
		expect(await planner.entry('2026-10-18')).toBeUndefined();
		await planner.expect_focus('2026-10-18');
		await expect(planner.status).toContainText('Undid change to 1 day');

		await planner.press('ControlOrMeta+z');
		expect(await planner.entry(TODAY)).toBeUndefined();

		await planner.press('ControlOrMeta+Shift+Z');
		expect((await planner.entry(TODAY))?.title).toBe('First');
		await planner.press('ControlOrMeta+y');
		expect((await planner.entry('2026-10-18'))?.title).toBe('Second');
	});

	test('undo restores a deleted block in one step', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await planner.press('ArrowUp', 'Delete');
		await planner.press('ControlOrMeta+z');
		const entries = await planner.entries();
		expect(Object.keys(entries)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
	});

	test('undo works across years', async ({ planner, page }) => {
		await planner.type_title('This year');
		await planner.press('PageDown');
		await planner.press('ControlOrMeta+z');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2026');
		await planner.expect_focus(TODAY);
	});

	test('ctrl+z inside the editor undoes typing, not the calendar', async ({ planner, page }) => {
		await planner.type_title('Saved');
		await planner.press('ArrowUp', 'Enter');
		await page.keyboard.type(' more');
		await planner.press('ControlOrMeta+z');
		await expect(planner.editor).toBeVisible();
		await planner.press('Escape');
		expect((await planner.entry(TODAY))?.title).toBe('Saved');
	});
});

test.describe('clipboard', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
	});

	test('copy and paste a block, keeping colors and descriptions', async ({ planner }) => {
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.type_title('Trip');
		await planner.press('ArrowUp', 'Alt+Digit3', 'ControlOrMeta+c');
		await expect(planner.status).toContainText('Copied 3 days');

		await planner.go_to('1 dec');
		await planner.press('ControlOrMeta+v');
		const entries = await planner.entries();
		for (const day of ['01', '02', '03']) {
			expect(entries[`2026-12-${day}`]).toEqual({
				title: 'Trip',
				description: '',
				color: 'yellow'
			});
		}
		expect(entries['2026-12-04']).toBeUndefined();
		await expect(planner.status).toContainText('Pasted into 3 days');
	});

	test('cut moves a day', async ({ planner }) => {
		await planner.type_title('Move me', 'ControlOrMeta+Enter');
		await planner.press('ControlOrMeta+x');
		expect(await planner.entry(TODAY)).toBeUndefined();
		await planner.press('ArrowRight', 'ControlOrMeta+v');
		expect((await planner.entry('2026-11-17'))?.title).toBe('Move me');
	});

	test('one copied day fills a selected range', async ({ planner }) => {
		await planner.type_title('Standup', 'ControlOrMeta+Enter');
		await planner.press('ControlOrMeta+c', 'ArrowDown');
		await planner.press('Shift+ArrowDown', 'Shift+ArrowDown', 'Shift+ArrowDown');
		await planner.press('ControlOrMeta+v');
		const entries = await planner.entries();
		expect(Object.values(entries).filter((entry) => entry.title === 'Standup')).toHaveLength(5);
	});

	test('pastes a column of lines from another app, one per day', async ({ planner, page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('Plan\r\nBuild\r\n\r\nShip\r\n'));
		await planner.go_to('2 nov');
		await planner.press('ControlOrMeta+v');
		const entries = await planner.entries();
		expect(entries['2026-11-02']?.title).toBe('Plan');
		expect(entries['2026-11-03']?.title).toBe('Build');
		expect(entries['2026-11-04']).toBeUndefined();
		expect(entries['2026-11-05']?.title).toBe('Ship');
	});

	test('pasting into the editor pastes text, not days', async ({ planner, page }) => {
		await page.evaluate(() => navigator.clipboard.writeText('Pasted text'));
		await planner.press('Enter', 'ControlOrMeta+v', 'Enter');
		expect((await planner.entry(TODAY))?.title).toBe('Pasted text');
		expect(await planner.entry('2026-10-18')).toBeUndefined();
	});
});
