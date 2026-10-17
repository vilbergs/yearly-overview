import { TAG_COLORS, is_tag_color, truncate, type TagColor } from './entries';

export type Settings = {
	/** Names for the color tags, e.g. `{ green: 'Holiday' }`. */
	categories: Partial<Record<TagColor, string>>;
	/** Whose public holidays to show (`SE`, `DE-BY`); none when unset. */
	holiday_country?: string;
};

export const SETTINGS_KEY = 'yearly-overview:settings:v1';
export const MAX_CATEGORY_LENGTH = 40;
/** `SE`, `DE-BY`, and the longer region codes date-holidays uses (`CK-Rarotonga`). */
const HOLIDAY_COUNTRY = /^[A-Z]{2}(-[A-Za-z0-9]{1,20})?$/;

export const default_settings = (): Settings => ({ categories: {} });

/** Validates untrusted settings (storage, server, backups), dropping anything malformed. */
export function normalize_settings(value: unknown): Settings {
	const categories: Settings['categories'] = {};
	const raw = (value as { categories?: unknown } | null)?.categories;

	if (typeof raw === 'object' && raw !== null) {
		for (const [color, name] of Object.entries(raw)) {
			if (!is_tag_color(color) || typeof name !== 'string') continue;
			const trimmed = truncate(name.trim(), MAX_CATEGORY_LENGTH).trim();
			if (trimmed) categories[color] = trimmed;
		}
	}

	const country = (value as { holiday_country?: unknown } | null)?.holiday_country;
	return typeof country === 'string' && HOLIDAY_COUNTRY.test(country)
		? { categories, holiday_country: country }
		: { categories };
}

export function load_settings(storage: Pick<Storage, 'getItem'> | undefined): Settings {
	try {
		return normalize_settings(JSON.parse(storage?.getItem(SETTINGS_KEY) ?? 'null'));
	} catch {
		return default_settings();
	}
}

export function save_settings(storage: Pick<Storage, 'setItem'> | undefined, settings: Settings) {
	try {
		storage?.setItem(SETTINGS_KEY, JSON.stringify(settings));
		return true;
	} catch {
		return false;
	}
}

/** The category's name, or the color itself when it has none. */
export function color_label(settings: Settings, color: TagColor) {
	return settings.categories[color] ?? color[0].toUpperCase() + color.slice(1);
}

export function has_categories(settings: Settings) {
	return TAG_COLORS.some((color) => settings.categories[color]);
}

/** Whether anything differs from the defaults (worth uploading on first sign-in). */
export function has_settings(settings: Settings) {
	return has_categories(settings) || !!settings.holiday_country;
}
