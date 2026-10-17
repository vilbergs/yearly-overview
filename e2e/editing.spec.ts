import { TODAY, expect, test } from './fixtures';

test.describe('editing days', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open();
	});

	test('typing starts editing and Enter saves and moves down', async ({ planner }) => {
		await planner.type_title('Dentist');
		await planner.expect_focus('2026-10-18');
		await expect(planner.cell(TODAY)).toContainText('Dentist');
		expect(await planner.entry(TODAY)).toEqual({ title: 'Dentist', description: '' });
	});

	test('Tab and Shift+Tab save and move sideways', async ({ planner }) => {
		await planner.type_title('A', 'Tab');
		await planner.expect_focus('2026-11-17');
		await planner.type_title('B', 'Shift+Tab');
		await planner.expect_focus(TODAY);
		expect((await planner.entry('2026-11-17')).title).toBe('B');
	});

	test('Shift+Enter saves and moves up', async ({ planner }) => {
		await planner.type_title('Up', 'Shift+Enter');
		await planner.expect_focus('2026-10-16');
	});

	test('arrow keys save while typing a new title', async ({ planner }) => {
		await planner.type_title('Gym', 'ArrowDown');
		await planner.type_title('Gym', 'ArrowDown');
		await planner.expect_focus('2026-10-19');
		expect((await planner.entry('2026-10-18')).title).toBe('Gym');
	});

	test('Escape cancels without saving', async ({ planner }) => {
		await planner.page.keyboard.type('Never mind');
		await planner.press('Escape');
		await planner.expect_focus(TODAY);
		expect(await planner.entry(TODAY)).toBeUndefined();
	});

	test('Enter and F2 edit the existing title', async ({ planner, page }) => {
		await planner.type_title('Lunch', 'ControlOrMeta+Enter');
		await planner.expect_focus(TODAY);
		await planner.press('F2');
		await expect(planner.editor).toHaveValue('Lunch');
		// The cursor is at the end, so typing appends.
		await page.keyboard.type(' with Sam');
		await planner.press('Enter');
		expect((await planner.entry(TODAY)).title).toBe('Lunch with Sam');

		await planner.press('ArrowUp', 'Enter');
		await expect(planner.editor).toHaveValue('Lunch with Sam');
		await planner.press('Escape');
	});

	test('arrow keys move the cursor when editing an existing title', async ({ planner, page }) => {
		await planner.type_title('ac', 'ControlOrMeta+Enter');
		await planner.press('Enter', 'ArrowLeft');
		await page.keyboard.type('b');
		await planner.press('Enter');
		expect((await planner.entry(TODAY)).title).toBe('abc');
	});

	test('clearing the title removes the day', async ({ planner }) => {
		await planner.type_title('Temp', 'ControlOrMeta+Enter');
		await planner.press('Enter', 'ControlOrMeta+a', 'Backspace', 'Enter');
		expect(await planner.entry(TODAY)).toBeUndefined();
	});

	test('Delete clears a day and says how to undo', async ({ planner }) => {
		await planner.type_title('Temp', 'ControlOrMeta+Enter');
		await planner.press('Delete');
		expect(await planner.entry(TODAY)).toBeUndefined();
		await expect(planner.status).toContainText('Cleared 1 day');
	});

	test('the details dialog edits description and color', async ({ planner, page }) => {
		await planner.press('Shift+Enter');
		const dialog = page.getByRole('dialog', { name: 'Saturday, October 17, 2026' });
		await expect(dialog).toBeVisible();
		await expect(dialog.getByLabel('Title')).toBeFocused();

		await page.keyboard.type('Dentist');
		await planner.press('Tab');
		await page.keyboard.type('9am\nBring insurance card');
		await planner.press('Tab', 'ArrowRight', 'ArrowRight');
		await expect(dialog.getByRole('radio', { name: 'orange' })).toBeChecked();
		await planner.press('ControlOrMeta+Enter');

		await expect(dialog).toBeHidden();
		await planner.expect_focus(TODAY);
		expect(await planner.entry(TODAY)).toEqual({
			title: 'Dentist',
			description: '9am\nBring insurance card',
			color: 'orange'
		});
		await expect(planner.status).toContainText('Bring insurance card');
		await expect(planner.cell(TODAY)).toHaveAttribute('title', /Bring insurance card/);
	});

	test('the details dialog can delete and cancel', async ({ planner, page }) => {
		await planner.type_title('Keep?', 'ControlOrMeta+Enter');
		await planner.press('Shift+Enter');
		await page.getByRole('button', { name: 'Cancel' }).click();
		expect((await planner.entry(TODAY)).title).toBe('Keep?');

		await planner.press('Shift+Enter');
		await page.getByRole('button', { name: 'Delete' }).click();
		expect(await planner.entry(TODAY)).toBeUndefined();
		await planner.expect_focus(TODAY);
	});

	test('Alt+number sets a color, even on an empty day', async ({ planner }) => {
		await planner.press('Alt+Digit5');
		expect(await planner.entry(TODAY)).toEqual({ title: '', description: '', color: 'blue' });
		await expect(planner.cell(TODAY)).toHaveClass(/tagged/);
		await planner.press('Alt+Digit0');
		expect(await planner.entry(TODAY)).toBeUndefined();
	});

	test('the mouse can select and edit too', async ({ planner, page }) => {
		await planner.cell('2026-03-10').click();
		await planner.expect_focus('2026-03-10');
		await planner.cell('2026-03-10').click();
		await expect(planner.editor).toBeVisible();
		await page.keyboard.type('Clicked');
		await planner.cell('2026-04-01').click();
		expect((await planner.entry('2026-03-10')).title).toBe('Clicked');
		await planner.expect_focus('2026-04-01');
	});

	test('long titles are capped at 200 characters', async ({ planner, page }) => {
		await planner.press('Enter');
		await page.keyboard.insertText('x'.repeat(250));
		await planner.press('Enter');
		expect((await planner.entry(TODAY)).title).toHaveLength(200);
	});
});
