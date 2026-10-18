import { describe, expect, it } from 'vitest';
import {
	HIDDEN_MONTHS_KEY,
	load_hidden_months,
	nearest_visible_month,
	normalize_hidden_months
} from './view';

describe('normalize_hidden_months', () => {
	it('keeps valid months per year, sorted and unique', () => {
		expect(normalize_hidden_months({ 2026: [3, 1, 1], 2027: [12] })).toEqual({
			2026: [1, 3],
			2027: [12]
		});
	});

	it('drops malformed years and months', () => {
		expect(
			normalize_hidden_months({ 2026: [0, 13, 1.5, '2', 4], abc: [1], 1800: [1], 2027: 'x' })
		).toEqual({ 2026: [4] });
		expect(normalize_hidden_months(null)).toEqual({});
		expect(normalize_hidden_months([1, 2])).toEqual({});
	});

	it('never hides every month, and drops empty years', () => {
		const all = Array.from({ length: 12 }, (_, i) => i + 1);
		expect(normalize_hidden_months({ 2026: all, 2027: [] })).toEqual({});
	});
});

describe('load_hidden_months', () => {
	it('survives broken storage', () => {
		expect(load_hidden_months({ getItem: () => '{oops' })).toEqual({});
		expect(load_hidden_months(undefined)).toEqual({});
		expect(
			load_hidden_months({ getItem: (key) => (key === HIDDEN_MONTHS_KEY ? '{"2026":[1]}' : null) })
		).toEqual({ 2026: [1] });
	});
});

describe('nearest_visible_month', () => {
	it('prefers the month itself, then later months', () => {
		expect(nearest_visible_month(5, [1, 2])).toBe(5);
		expect(nearest_visible_month(2, [1, 2])).toBe(3);
		expect(nearest_visible_month(12, [11, 12])).toBe(10);
	});
});
