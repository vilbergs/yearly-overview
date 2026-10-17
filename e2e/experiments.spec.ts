import { TODAY, expect, test } from './fixtures';

const trip = { title: 'Trip', description: '', color: 'green' };

test.describe('quick add from the palette', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: { '2027-07-08': { title: 'Dentist', description: '' } },
			settings: { categories: { green: 'Holiday', orange: 'Health' } }
		});
	});

	test('previews and adds an event from a phrase', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('Dentist checkup fri #health');
		const first = page.getByRole('option').first();
		await expect(first).toHaveText(/Add “Dentist checkup” · Friday, October 23, 2026 · Health/);
		await planner.press('Enter');

		await planner.expect_focus('2026-10-23');
		expect(await planner.entry('2026-10-23')).toEqual({
			title: 'Dentist checkup',
			description: '',
			color: 'orange'
		});
		await expect(planner.status).toContainText('Added “Dentist checkup”');
	});

	test('adds a range and warns about what it replaces', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('Vacation jul 6-10 #holiday');
		const first = page.getByRole('option').first();
		await expect(first).toContainText('Add “Vacation” · Jul 6 – Jul 10, 2027 · 5 days · Holiday');
		await expect(first).toContainText('replaces 1 day');
		await planner.press('Enter');

		await expect(page.getByRole('heading', { level: 1 })).toHaveText('2027');
		const entries = await planner.entries();
		for (const day of ['06', '07', '08', '09', '10']) {
			expect(entries[`2027-07-${day}`]?.title).toBe('Vacation');
		}

		// One undo step brings the dentist back.
		await planner.press('ControlOrMeta+z');
		expect((await planner.entry('2027-07-08'))?.title).toBe('Dentist');
		expect(await planner.entry('2027-07-06')).toBeUndefined();
	});

	test('plain searches and dates still work as before', async ({ planner, page }) => {
		await planner.press('ControlOrMeta+k');
		await page.getByRole('combobox').fill('14 mar');
		await expect(page.getByRole('option').first()).toContainText('Go to');
		await page.getByRole('combobox').fill('dentist');
		await expect(page.getByRole('option').first()).toContainText('Dentist');
		await expect(page.getByRole('option').first()).not.toContainText('Add');
	});
});

test.describe('moving and stretching events', () => {
	test.beforeEach(async ({ planner }) => {
		await planner.open({
			entries: {
				'2026-10-19': trip,
				'2026-10-20': trip,
				'2026-10-21': trip,
				'2026-10-27': { title: 'Dentist', description: '' }
			}
		});
		await planner.press('ArrowDown', 'ArrowDown'); // Oct 19, inside the trip
	});

	const titles = async (planner: import('./fixtures').Planner) =>
		Object.entries(await planner.entries())
			.filter(([, entry]) => entry.title === 'Trip')
			.map(([key]) => key)
			.sort();

	test('Alt+arrows move the whole event and the cursor with it', async ({ planner }) => {
		await planner.press('Alt+ArrowDown');
		expect(await titles(planner)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
		await planner.expect_focus('2026-10-20');
		await expect(planner.status).toContainText('Moved to Oct 20 – Oct 22');

		await planner.press('Alt+ArrowUp', 'Alt+ArrowUp');
		expect(await titles(planner)).toEqual(['2026-10-18', '2026-10-19', '2026-10-20']);

		await planner.press('ControlOrMeta+z', 'ControlOrMeta+z', 'ControlOrMeta+z');
		expect(await titles(planner)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
	});

	test('refuses to move onto other plans', async ({ planner }) => {
		await planner.press('Alt+ArrowRight'); // a week later would cover the dentist
		await expect(planner.status).toContainText('Can’t move: “Dentist” is on Oct 27');
		expect(await titles(planner)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21']);
	});

	test('Alt+Shift+arrows stretch and shrink the end', async ({ planner }) => {
		await planner.press('Alt+Shift+ArrowDown', 'Alt+Shift+ArrowDown');
		expect(await titles(planner)).toEqual([
			'2026-10-19',
			'2026-10-20',
			'2026-10-21',
			'2026-10-22',
			'2026-10-23'
		]);
		await expect(planner.status).toContainText('Now Oct 19 – Oct 23 · 5 days');

		await planner.press('Alt+Shift+ArrowUp', 'Alt+Shift+ArrowUp', 'Alt+Shift+ArrowUp');
		expect(await titles(planner)).toEqual(['2026-10-19', '2026-10-20']);

		await planner.press('Alt+Shift+ArrowUp', 'Alt+Shift+ArrowUp');
		await expect(planner.status).toContainText('at least one day');
		expect(await titles(planner)).toEqual(['2026-10-19']);

		await planner.press('Alt+Shift+ArrowRight'); // to Oct 26, just before the dentist
		expect((await titles(planner)).at(-1)).toBe('2026-10-26');
		await planner.press('Alt+Shift+ArrowRight'); // another week would cover the dentist
		await expect(planner.status).toContainText('Can’t extend: “Dentist” is on Oct 27');
	});

	test('moves a selected range too', async ({ planner }) => {
		await planner.go_to('27 oct');
		await planner.press('Alt+ArrowDown');
		expect((await planner.entry('2026-10-28'))?.title).toBe('Dentist');
		expect(await planner.entry('2026-10-27')).toBeUndefined();
	});
});

test.describe('time awareness', () => {
	test('past days are muted, and it can be turned off', async ({ planner }) => {
		await planner.open({ entries: { '2026-10-16': { title: 'Done', description: '' } } });
		await expect(planner.cell('2026-10-16')).toHaveClass(/past/);
		await expect(planner.cell(TODAY)).not.toHaveClass(/past/);

		await planner.go_to('mute past days');
		await expect(planner.cell('2026-10-16')).not.toHaveClass(/past/);
		await planner.page.reload();
		await expect(planner.cell('2026-10-16')).not.toHaveClass(/past/);
	});

	test('the toolbar shows what’s next and jumps to it', async ({ planner, page }) => {
		await planner.open({
			entries: {
				'2026-10-10': { title: 'Already over', description: '' },
				'2026-10-29': trip,
				'2026-10-30': trip
			}
		});
		const chip = page.getByRole('button', { name: /^Next: Trip/ });
		await expect(chip).toContainText('in 12 days');
		await chip.click();
		await planner.expect_focus('2026-10-29');
	});

	test('it says when something is happening now', async ({ planner, page }) => {
		await planner.open({ entries: { [TODAY]: trip, '2026-10-18': trip, '2026-10-19': trip } });
		await expect(page.getByRole('button', { name: /^Now: Trip/ })).toContainText('3 days left');
	});
});
