import { describe, expect, it } from 'vitest';
import {
	export_backup,
	load_entries,
	MAX_TITLE_LENGTH,
	normalize_entry,
	parse_backup,
	parse_entries,
	same_entry,
	save_entries,
	STORAGE_KEY
} from './entries';

describe('normalize_entry', () => {
	it('trims and drops empty entries', () => {
		expect(normalize_entry({ title: '  Trip ', description: ' \n' })).toEqual({
			title: 'Trip',
			description: ''
		});
		expect(normalize_entry({ title: '  ', description: '' })).toBeNull();
	});

	it('never splits a character when capping', () => {
		const title = 'x'.repeat(199) + '😀😀';
		const entry = normalize_entry({ title, description: '' });
		expect(entry?.title).toBe('x'.repeat(199) + '😀');
		// No lone surrogate halves, which the server would reject as invalid JSON text.
		expect(entry?.title.isWellFormed()).toBe(true);
	});

	it('caps the title length', () => {
		const entry = normalize_entry({ title: 'x'.repeat(1000), description: '' });
		expect(entry?.title).toHaveLength(MAX_TITLE_LENGTH);
	});
});

describe('parse_entries', () => {
	it('returns an empty object for missing or corrupt data', () => {
		expect(parse_entries(null)).toEqual({});
		expect(parse_entries('not json')).toEqual({});
		expect(parse_entries('[]')).toEqual({});
		expect(parse_entries('42')).toEqual({});
	});

	it('keeps valid entries and drops malformed ones', () => {
		const raw = JSON.stringify({
			'2025-01-01': { title: 'New year', description: 'Party' },
			'2025-01-02': { title: 'No description' },
			'2025-01-03': { title: 5 },
			'2025-01-04': null,
			'not-a-date': { title: 'Nope', description: '' }
		}).replace(/}$/, ',"__proto__":{"title":"Nope","description":""}}');

		expect(parse_entries(raw)).toEqual({
			'2025-01-01': { title: 'New year', description: 'Party' },
			'2025-01-02': { title: 'No description', description: '' }
		});
	});
});

describe('load_entries / save_entries', () => {
	it('round-trips through storage', () => {
		const store = new Map<string, string>();
		const storage = {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value)
		};

		expect(save_entries(storage, { '2025-05-01': { title: 'May day', description: '' } })).toBe(
			true
		);
		expect(store.has(STORAGE_KEY)).toBe(true);
		expect(load_entries(storage)).toEqual({ '2025-05-01': { title: 'May day', description: '' } });
	});

	it('survives storage that throws', () => {
		const broken = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('quota');
			}
		};

		expect(load_entries(broken)).toEqual({});
		expect(save_entries(broken, {})).toBe(false);
		expect(load_entries(undefined)).toEqual({});
		expect(save_entries(undefined, {})).toBe(false);
	});
});

describe('colors', () => {
	it('keeps valid colors and color-only entries, drops unknown colors', () => {
		expect(normalize_entry({ title: '', description: '', color: 'green' })).toEqual({
			title: '',
			description: '',
			color: 'green'
		});
		expect(
			parse_entries(JSON.stringify({ '2025-01-01': { title: 'A', color: 'chartreuse' } }))
		).toEqual({ '2025-01-01': { title: 'A', description: '' } });
	});

	it('compares entries by content', () => {
		expect(same_entry({ title: 'A', description: '' }, { title: 'A', description: '' })).toBe(true);
		expect(
			same_entry({ title: 'A', description: '' }, { title: 'A', description: '', color: 'red' })
		).toBe(false);
		expect(same_entry(undefined, undefined)).toBe(false);
	});
});

describe('backups', () => {
	it('round-trips and accepts bare entry maps', () => {
		const entries = { '2025-01-01': { title: 'A', description: 'B', color: 'red' as const } };
		const settings = { categories: { red: 'Work' } };
		expect(parse_backup(export_backup(entries, settings))).toEqual({ entries, settings });
		expect(parse_backup(JSON.stringify(entries))).toEqual({ entries });
	});

	it('rejects files that are not backups', () => {
		expect(parse_backup('nope')).toBeNull();
		expect(parse_backup('[1, 2]')).toBeNull();
	});
});
