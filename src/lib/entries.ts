export const TAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TagColor = (typeof TAG_COLORS)[number];

export type Entry = {
	title: string;
	description: string;
	color?: TagColor;
};

/** Entries keyed by ISO date (`YYYY-MM-DD`). */
export type Entries = Record<string, Entry>;

export const STORAGE_KEY = 'yearly-overview:entries:v1';
const EXPORT_APP_ID = 'yearly-overview';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MAX_TITLE_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 5000;

export function is_tag_color(value: unknown): value is TagColor {
	return TAG_COLORS.includes(value as TagColor);
}

/**
 * Caps text at `max` characters (code points, as the server counts them), never splitting an
 * emoji or other character that takes two UTF-16 units.
 */
export function truncate(text: string, max: number) {
	if (text.length <= max) return text;
	return Array.from(text).slice(0, max).join('');
}

/** Trims and caps an entry. Returns null when nothing is left worth keeping. */
export function normalize_entry(entry: Entry): Entry | null {
	const title = truncate(entry.title.trim(), MAX_TITLE_LENGTH).trim();
	const description = truncate(entry.description.trim(), MAX_DESCRIPTION_LENGTH).trim();
	const color = is_tag_color(entry.color) ? entry.color : undefined;

	if (!title && !description && !color) return null;

	return color ? { title, description, color } : { title, description };
}

/** Whether two days show the same thing, so they read as one multi-day block. */
export function same_entry(a: Entry | undefined, b: Entry | undefined) {
	return (
		!!a && !!b && a.title === b.title && a.description === b.description && a.color === b.color
	);
}

/** Validates untrusted data, dropping anything malformed instead of throwing. */
export function to_entries(value: unknown): Entries {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

	const entries: Entries = {};

	for (const [key, candidate] of Object.entries(value)) {
		if (!DATE_KEY_PATTERN.test(key)) continue;
		if (typeof candidate !== 'object' || candidate === null) continue;

		const { title, description, color } = candidate as Record<string, unknown>;

		const entry = normalize_entry({
			title: typeof title === 'string' ? title : '',
			description: typeof description === 'string' ? description : '',
			color: is_tag_color(color) ? color : undefined
		});
		if (entry) entries[key] = entry;
	}

	return entries;
}

export function parse_entries(raw: string | null): Entries {
	if (!raw) return {};

	try {
		return to_entries(JSON.parse(raw));
	} catch {
		return {};
	}
}

export function load_entries(storage: Pick<Storage, 'getItem'> | undefined): Entries {
	try {
		return parse_entries(storage?.getItem(STORAGE_KEY) ?? null);
	} catch {
		// Storage can throw (disabled cookies, private mode in some browsers).
		return {};
	}
}

/** Returns false when the data could not be persisted (quota exceeded, storage blocked). */
export function save_entries(storage: Pick<Storage, 'setItem'> | undefined, entries: Entries) {
	if (!storage) return false;

	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(entries));
		return true;
	} catch {
		return false;
	}
}

/** `window.localStorage` itself can throw when storage is blocked, so access it defensively. */
export function get_browser_storage(): Storage | undefined {
	try {
		return typeof window === 'undefined' ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}

export function export_backup(entries: Entries, settings?: unknown, now = new Date()) {
	return JSON.stringify(
		{ app: EXPORT_APP_ID, version: 2, exported_at: now.toISOString(), entries, settings },
		null,
		'\t'
	);
}

/**
 * Reads a backup file (or a bare entries object). Returns null when the file is not usable.
 * `settings` is the raw value; callers validate it.
 */
export function parse_backup(text: string): { entries: Entries; settings?: unknown } | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}

	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

	const wrapper = value as Record<string, unknown>;
	if (wrapper.app !== EXPORT_APP_ID) return { entries: to_entries(value) };
	return { entries: to_entries(wrapper.entries), settings: wrapper.settings };
}

/** Hue (oklch) per tag color; the theme decides lightness and chroma. */
export const TAG_HUES: Record<TagColor, number> = {
	red: 25,
	orange: 60,
	yellow: 95,
	green: 150,
	blue: 250,
	purple: 305
};
