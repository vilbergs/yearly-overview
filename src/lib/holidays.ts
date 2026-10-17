/**
 * Public holidays, from the `date-holidays` data set (207 countries, CC-BY-3.0). The library is
 * large, so it is only downloaded once someone picks a country.
 */

/** Holiday names keyed by ISO date. */
export type HolidayMap = Record<string, string>;

type HolidaysModule = typeof import('date-holidays');

let module_promise: Promise<HolidaysModule> | undefined;
const cache = new Map<string, HolidayMap>();

function load_library() {
	module_promise ??= import('date-holidays');
	return module_promise;
}

/** Languages to try for holiday names, best first: the browser's, then English. */
function languages() {
	const preferred = typeof navigator === 'undefined' ? [] : navigator.languages;
	return [...preferred.map((language) => language.split('-')[0].toLowerCase()), 'en'];
}

/** Official public holidays for `country` (`SE`, `DE-BY`) in `year`. */
export async function get_holidays(country: string, year: number): Promise<HolidayMap> {
	const cache_key = `${country}:${year}`;
	const cached = cache.get(cache_key);
	if (cached) return cached;

	const { default: Holidays } = await load_library();
	const [code, region] = country.split('-');
	const holidays = new Holidays(code, region ?? '', { languages: languages(), types: ['public'] });

	const map: HolidayMap = {};
	for (const holiday of holidays.getHolidays(year) || []) {
		const key = holiday.date.slice(0, 10);
		// Some days have two names (e.g. a holiday that is also a Sunday); keep the first.
		map[key] ??= holiday.name;
	}

	cache.set(cache_key, map);
	return map;
}

export type Country = { code: string; name: string; regions: { code: string; name: string }[] };

/** Every supported country and its regions, named in the browser's language when possible. */
export async function list_countries(): Promise<Country[]> {
	const { default: Holidays } = await load_library();
	const holidays = new Holidays();
	const language = languages()[0];

	return Object.entries(holidays.getCountries(language) ?? {})
		.map(([code, name]) => ({
			code,
			name,
			regions: Object.entries(holidays.getStates(code, language) ?? {})
				.map(([region, region_name]) => ({ code: `${code}-${region}`, name: region_name }))
				.sort((a, b) => a.name.localeCompare(b.name))
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** A sensible default from the browser locale (`sv-SE` → `SE`), if supported. */
export function guess_country(countries: Country[]) {
	const locales = typeof navigator === 'undefined' ? [] : navigator.languages;
	for (const locale of locales) {
		const region = locale.split('-')[1]?.toUpperCase();
		if (region && countries.some((country) => country.code === region)) return region;
	}
	return undefined;
}
