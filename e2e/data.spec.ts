import { readFile, writeFile } from 'node:fs/promises';
import { TODAY, expect, test } from './fixtures';

test.describe('local data', () => {
	test('entries survive a reload', async ({ planner, page }) => {
		await planner.open();
		await planner.type_title('Persisted');
		await page.reload();
		await expect(planner.cell(TODAY)).toContainText('Persisted');
	});

	test('corrupt saved data is ignored instead of breaking the app', async ({ planner, page }) => {
		await planner.open();
		await page.evaluate(() => localStorage.setItem('yearly-overview:entries:v1', '{oops'));
		await page.reload();
		await expect(planner.cell(TODAY)).toBeFocused();
		await planner.type_title('Still works');
		expect((await planner.entry(TODAY))?.title).toBe('Still works');
	});

	test('open tabs stay in sync', async ({ planner, context }) => {
		await planner.open();
		const other = await context.newPage();
		await other.goto('/');
		await planner.type_title('From tab one');
		await expect(other.locator(`[data-key="${TODAY}"]`)).toContainText('From tab one');
	});

	test('backup downloads and restores', async ({ planner, page }, testInfo) => {
		await planner.open({
			entries: { '2026-02-14': { title: 'Valentine', description: 'Dinner', color: 'red' } }
		});

		await page.getByText('More', { exact: true }).click();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: 'Download backup' }).click()
		]);
		expect(download.suggestedFilename()).toBe(`yearly-overview-${TODAY}.json`);
		const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
		expect(backup.app).toBe('yearly-overview');
		expect(backup.entries['2026-02-14']).toEqual({
			title: 'Valentine',
			description: 'Dinner',
			color: 'red'
		});

		// Restore into an empty planner.
		await page.evaluate(() => localStorage.clear());
		await page.reload();
		await expect(planner.cell('2026-02-14')).not.toContainText('Valentine');

		const file = testInfo.outputPath('backup.json');
		await writeFile(file, JSON.stringify(backup));
		await page.getByText('More', { exact: true }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('button', { name: 'Restore backup…' }).click()
		]);
		await chooser.setFiles(file);
		await expect(planner.cell('2026-02-14')).toContainText('Valentine');
		await expect(planner.status).toContainText('Imported 1 day');

		// Restoring is undoable.
		await planner.press('ControlOrMeta+z');
		await expect(planner.cell('2026-02-14')).not.toContainText('Valentine');
	});

	test('rejects files that are not backups', async ({ planner, page }, testInfo) => {
		await planner.open();
		const file = testInfo.outputPath('nope.json');
		await writeFile(file, 'not json at all');
		await page.getByText('More', { exact: true }).click();
		const [chooser] = await Promise.all([
			page.waitForEvent('filechooser'),
			page.getByRole('button', { name: 'Restore backup…' }).click()
		]);
		await chooser.setFiles(file);
		await expect(planner.status).toContainText('not a Yearly Overview backup');
	});

	test('exports blocks to an iCalendar file', async ({ planner, page }) => {
		await planner.open({
			entries: {
				'2026-07-06': { title: 'Vacation', description: '', color: 'green' },
				'2026-07-07': { title: 'Vacation', description: '', color: 'green' },
				'2026-07-08': { title: 'Vacation', description: '', color: 'green' }
			}
		});
		const [download] = await Promise.all([page.waitForEvent('download'), planner.go_to('ics')]);
		const ics = await readFile(await download.path(), 'utf8');
		expect(ics).toContain('BEGIN:VCALENDAR');
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(ics).toContain('DTSTART;VALUE=DATE:20260706');
		expect(ics).toContain('DTEND;VALUE=DATE:20260709');
	});

	test('print layout hides the controls and shows the year', async ({ planner, page }) => {
		await planner.open();
		await page.emulateMedia({ media: 'print' });
		await expect(page.locator('header.toolbar')).toBeHidden();
		await expect(planner.status).toBeHidden();
		await expect(page.locator('.print-only')).toHaveText('2026');
	});
});
