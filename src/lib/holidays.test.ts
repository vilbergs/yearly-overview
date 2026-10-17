import { describe, expect, it } from 'vitest';
import { get_holidays, list_countries } from './holidays';

describe('holidays', () => {
	it('lists the public holidays of a country', async () => {
		const holidays = await get_holidays('SE', 2026);
		expect(holidays['2026-06-19']).toBeUndefined(); // Midsummer Eve is not public…
		expect(holidays['2026-06-20']).toBeDefined(); // …but Midsummer Day is.
		expect(holidays['2026-12-25']).toBeDefined();
		expect(holidays['2026-03-10']).toBeUndefined();
	});

	it('supports regions', async () => {
		const bavaria = await get_holidays('DE-BY', 2026);
		const berlin = await get_holidays('DE-BE', 2026);
		// Epiphany is a public holiday in Bavaria but not in Berlin.
		expect(bavaria['2026-01-06']).toBeDefined();
		expect(berlin['2026-01-06']).toBeUndefined();
	});

	it('lists countries with regions', async () => {
		const countries = await list_countries();
		expect(countries.length).toBeGreaterThan(150);
		const germany = countries.find((country) => country.code === 'DE');
		expect(germany?.regions.some((region) => region.code === 'DE-BY')).toBe(true);
	});
});
