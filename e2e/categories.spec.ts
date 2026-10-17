import { readFile } from 'node:fs/promises';
import { TODAY, expect, test } from './fixtures';

test.describe('categories', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: {
				'2026-07-06': { title: 'Vacation', description: '', color: 'green' },
				'2026-07-07': { title: 'Vacation', description: '', color: 'green' },
				'2026-03-02': { title: 'Planning', description: '', color: 'red' },
				'2026-03-03': { title: 'Untagged', description: '' }
			}
		});
	});

	async function name_categories(page: import('@playwright/test').Page) {
		await page.keyboard.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('name categories');
		await page.keyboard.press('Enter');
		const dialog = page.getByRole('dialog', { name: 'Categories' });
		await expect(dialog.getByLabel('Name for red')).toBeFocused();
		await page.keyboard.type('Work');
		await dialog.getByLabel('Name for green').fill('Holiday');
		await page.keyboard.press('ControlOrMeta+Enter');
		await expect(dialog).toBeHidden();
	}

	test('naming categories shows a legend', async ({ planner, page }) => {
		await name_categories(page);
		const legend = page.getByRole('list', { name: 'Categories' });
		await expect(legend.getByRole('button')).toHaveText(['Work', 'Holiday']);
		await planner.expect_focus(TODAY);
		await expect(planner.cell('2026-07-06')).toHaveAccessibleName(/Vacation, Holiday$/);
	});

	test('names appear in the details dialog and palette', async ({ planner, page }) => {
		await name_categories(page);
		await planner.press('Shift+Enter');
		await expect(page.getByRole('radio', { name: 'Work' })).toBeVisible();
		await planner.press('Escape');

		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('tag holiday');
		await expect(page.getByRole('option', { selected: true })).toContainText('Tag: Holiday');
		await planner.press('Enter');
		expect((await planner.entry(TODAY))?.color).toBe('green');
		await expect(planner.status).toContainText('Tagged 1 day Holiday');
	});

	test('Alt+Shift+number highlights one category; Esc clears it', async ({ planner }) => {
		await planner.press('Alt+Shift+Digit4');
		await expect(planner.cell('2026-07-06')).not.toHaveClass(/dimmed/);
		await expect(planner.cell('2026-03-02')).toHaveClass(/dimmed/);
		await expect(planner.cell('2026-03-03')).toHaveClass(/dimmed/);
		await expect(planner.status).toContainText('Highlighting Green (2 days)');

		await planner.press('Escape');
		await expect(planner.cell('2026-03-02')).not.toHaveClass(/dimmed/);
	});

	test('legend buttons toggle the highlight', async ({ planner, page }) => {
		await name_categories(page);
		const work = page.getByRole('button', { name: 'Work', exact: true });
		await work.click();
		await expect(work).toHaveAttribute('aria-pressed', 'true');
		await expect(planner.cell('2026-07-06')).toHaveClass(/dimmed/);
		await planner.expect_focus(TODAY);
		await work.click();
		await expect(work).toHaveAttribute('aria-pressed', 'false');
	});

	test('category names are part of backups and calendar exports', async ({ planner, page }) => {
		await name_categories(page);
		const [backup] = await Promise.all([
			page.waitForEvent('download'),
			planner.go_to('download backup')
		]);
		const json = JSON.parse(await readFile(await backup.path(), 'utf8'));
		expect(json.settings).toEqual({ categories: { red: 'Work', green: 'Holiday' } });

		const [ics] = await Promise.all([page.waitForEvent('download'), planner.go_to('ics')]);
		expect(await readFile(await ics.path(), 'utf8')).toContain('CATEGORIES:Holiday');
	});
});
