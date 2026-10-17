import { expect, test } from './fixtures';

test.describe('public holidays', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: { '2026-12-25': { title: 'Family dinner', description: '' } }
		});
	});

	async function choose(page: import('@playwright/test').Page, country: string, region?: string) {
		await page.keyboard.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('public holidays');
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Public holidays' });
		await expect(dialog.getByLabel('Country', { exact: true })).toBeFocused();
		await dialog.getByLabel('Country', { exact: true }).selectOption(country);
		if (region) await dialog.getByLabel('Region', { exact: true }).selectOption(region);
		await dialog.getByRole('button', { name: 'Save' }).click();
		await expect(dialog).toBeHidden();
	}

	test('suggests the country from the browser locale', async ({ page }) => {
		await page.keyboard.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('public holidays');
		await page.keyboard.press('Enter');
		await expect(page.getByLabel('Country', { exact: true })).toHaveValue('US');
	});

	test('shows holidays as red days with their names', async ({ planner, page }) => {
		await choose(page, 'SE');

		const midsummer = planner.cell('2026-06-20');
		await expect(midsummer).toHaveClass(/holiday/);
		await expect(midsummer.locator('.holiday-name')).toHaveText('Midsummer Day');
		await expect(midsummer).toHaveAccessibleName(/Midsummer Day/);

		// An entry on a holiday wins the title; the holiday stays in the label and status bar.
		const christmas = planner.cell('2026-12-25');
		await expect(christmas.locator('.title')).toHaveText('Family dinner');
		await expect(christmas).toHaveAccessibleName(/Christmas Day/);

		await planner.go_to('20 jun');
		await expect(planner.status).toContainText('Midsummer Day');

		// Ordinary days are untouched.
		await expect(planner.cell('2026-06-19')).not.toHaveClass(/holiday/);
	});

	test('holidays follow the shown year', async ({ planner, page }) => {
		await choose(page, 'SE');
		await planner.press('PageDown');
		await expect(planner.cell('2027-06-26')).toHaveClass(/holiday/); // Midsummer Day 2027
	});

	test('regions add regional holidays', async ({ planner, page }) => {
		await choose(page, 'DE', 'DE-BY');
		await expect(planner.cell('2026-01-06')).toHaveClass(/holiday/);

		await choose(page, 'DE', 'DE-BE');
		await expect(planner.cell('2026-01-06')).not.toHaveClass(/holiday/);
	});

	test('holidays are searchable in the palette', async ({ planner, page }) => {
		await choose(page, 'SE');
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('midsummer');
		await expect(page.getByRole('option').first()).toContainText('Public holiday');
		await planner.press('Enter');
		await planner.expect_focus('2026-06-20');
	});

	test('can be turned off, and survives a reload', async ({ planner, page }) => {
		await choose(page, 'SE');
		await page.reload();
		await expect(planner.cell('2026-06-20')).toHaveClass(/holiday/);

		await choose(page, '');
		await expect(planner.cell('2026-06-20')).not.toHaveClass(/holiday/);
	});
});
