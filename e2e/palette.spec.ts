import { TODAY, expect, test } from './fixtures';

test.describe('command palette', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: {
				'2026-03-14': { title: 'Pi day party', description: 'Bring pie' },
				'2026-08-01': { title: 'Family trip', description: '', color: 'green' },
				'2026-08-02': { title: 'Family trip', description: '', color: 'green' },
				'2027-01-05': { title: 'Kickoff', description: '' }
			}
		});
	});

	test('opens with Ctrl/Cmd+K and closes with Escape', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await expect(page.getByRole('combobox')).toBeFocused();
		await planner.press('Escape');
		await expect(page.getByRole('combobox')).toBeHidden();
		await planner.expect_focus(TODAY);
	});

	for (const [query, key] of [
		['14 mar', '2026-03-14'],
		['march 14', '2026-03-14'],
		['2027-06-30', '2027-06-30'],
		['dec', '2026-12-01'],
		['2030', '2030-01-01']
	]) {
		test(`jumps to "${query}"`, async ({ planner }) => {
			await planner.go_to(query);
			await planner.expect_focus(key);
		});
	}

	test('searches titles and descriptions across years', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('pie');
		await expect(page.getByRole('option').first()).toContainText('Pi day party');

		await page.getByRole('combobox').fill('kickoff');
		await planner.press('Enter');
		await planner.expect_focus('2027-01-05');
	});

	test('shows a multi-day block once with its date range', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('family');
		await expect(page.getByRole('option')).toHaveCount(1);
		await expect(page.getByRole('option')).toContainText('Aug 1, 2026 – Sun, Aug 2, 2026');
	});

	test('arrow keys pick a result', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('year');
		await expect(page.getByRole('option', { selected: true })).toContainText('Next year');
		await planner.press('ArrowDown');
		await expect(page.getByRole('option', { selected: true })).toContainText('Previous year');
		await planner.press('Enter');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2025');
	});

	test('runs commands on the selection', async ({ planner, page }) => {
		await planner.go_to('14 mar');
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('color purple');
		await planner.press('Enter');
		expect((await planner.entry('2026-03-14'))?.color).toBe('purple');
	});

	test('empty query with Enter goes to today', async ({ planner }) => {
		await planner.press('PageDown', 'ControlOrMeta+k', 'Enter');
		await planner.expect_focus(TODAY);
	});

	test('says when nothing matches', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('zzzz');
		await expect(page.getByText('No matches')).toBeVisible();
	});

	test('the shortcuts overlay lists every group', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+/');
		const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
		await expect(dialog).toBeVisible();
		for (const group of ['Move', 'Select', 'Edit', 'Help']) {
			await expect(dialog.getByRole('heading', { name: group })).toBeVisible();
		}
		await planner.press('Escape');
		await planner.expect_focus(TODAY);
	});
});
