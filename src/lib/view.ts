import { MAX_YEAR, MIN_YEAR } from './calendar';

/**
 * Months collapsed in the grid, per year (`{ 2026: [1, 2] }`). A view preference for this
 * device, so it's kept in local storage and never synced.
 */
export type HiddenMonths = Record<number, number[]>;

export const HIDDEN_MONTHS_KEY = 'yearly-overview:hidden-months:v1';

/** Validates untrusted hidden months, dropping anything malformed. At least one month stays. */
export function normalize_hidden_months(value: unknown): HiddenMonths {
	const result: HiddenMonths = {};
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return result;

	for (const [year, months] of Object.entries(value)) {
		const number = Number(year);
		if (!Number.isInteger(number) || number < MIN_YEAR || number > MAX_YEAR) continue;
		if (!Array.isArray(months)) continue;

		const valid = [...new Set(months)]
			.filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
			.sort((a, b) => a - b);
		if (valid.length > 0 && valid.length < 12) result[number] = valid;
	}

	return result;
}

export function load_hidden_months(storage: Pick<Storage, 'getItem'> | undefined): HiddenMonths {
	try {
		return normalize_hidden_months(JSON.parse(storage?.getItem(HIDDEN_MONTHS_KEY) ?? 'null'));
	} catch {
		return {};
	}
}

export function save_hidden_months(
	storage: Pick<Storage, 'setItem'> | undefined,
	hidden: HiddenMonths
) {
	try {
		storage?.setItem(HIDDEN_MONTHS_KEY, JSON.stringify(hidden));
		return true;
	} catch {
		return false;
	}
}

/** The closest month that isn't hidden, preferring later ones; `month` itself when visible. */
export function nearest_visible_month(month: number, hidden: readonly number[]) {
	for (let distance = 0; distance < 12; distance++) {
		for (const candidate of [month + distance, month - distance]) {
			if (candidate >= 1 && candidate <= 12 && !hidden.includes(candidate)) return candidate;
		}
	}
	return month;
}
