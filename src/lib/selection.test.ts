import { describe, expect, it } from 'vitest';
import { get_days_of_year } from './calendar';
import type { Entries } from './entries';
import { list_runs, range_keys, run_keys, target_keys } from './selection';

const days = get_days_of_year(2026);
const index = new Map(days.map((day, i) => [day.key, i]));
const trip = { title: 'Trip', description: '', color: 'blue' as const };
const entries: Entries = {
	'2026-01-30': trip,
	'2026-01-31': trip,
	'2026-02-01': trip,
	'2026-02-02': { title: 'Back home', description: '' }
};

describe('list_runs', () => {
	it('merges consecutive identical days across months', () => {
		expect(list_runs(entries)).toEqual([
			{ start: '2026-01-30', end: '2026-02-01', entry: trip },
			{ start: '2026-02-02', end: '2026-02-02', entry: { title: 'Back home', description: '' } }
		]);
	});
});

describe('selection', () => {
	it('selects ranges in calendar order regardless of direction', () => {
		expect(range_keys(days, index, '2026-02-02', '2026-01-31')).toEqual([
			'2026-01-31',
			'2026-02-01',
			'2026-02-02'
		]);
	});

	it('targets the whole block under the cursor', () => {
		expect(run_keys(days, index, entries, '2026-01-31')).toEqual([
			'2026-01-30',
			'2026-01-31',
			'2026-02-01'
		]);
		expect(target_keys(days, index, entries, '2026-03-01', '2026-03-01')).toEqual(['2026-03-01']);
		expect(target_keys(days, index, entries, '2026-01-31', '2026-01-31')).toHaveLength(3);
		expect(target_keys(days, index, entries, '2026-01-31', '2026-02-01')).toEqual([
			'2026-01-31',
			'2026-02-01'
		]);
	});
});
