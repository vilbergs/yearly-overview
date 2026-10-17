import { describe, expect, it } from 'vitest';
import {
	add_days,
	days_in_month,
	get_days_of_year,
	is_leap_year,
	iso_week,
	move_in_grid,
	parse_date_query,
	same_day_in_year,
	to_date_key
} from './calendar';

describe('is_leap_year', () => {
	it('follows the Gregorian rules', () => {
		expect(is_leap_year(2024)).toBe(true);
		expect(is_leap_year(2025)).toBe(false);
		expect(is_leap_year(1900)).toBe(false);
		expect(is_leap_year(2000)).toBe(true);
	});
});

describe('get_days_of_year', () => {
	it('returns every day of the year in order', () => {
		expect(get_days_of_year(2025)).toHaveLength(365);
		expect(get_days_of_year(2024)).toHaveLength(366);

		const days = get_days_of_year(2025);
		expect(days[0]).toMatchObject({ key: '2025-01-01', month: 1, day: 1, weekday: 3 });
		expect(days.at(-1)).toMatchObject({ key: '2025-12-31', month: 12, day: 31 });
	});

	it('marks weekends', () => {
		const days = get_days_of_year(2025);
		// 2025-01-04 is a Saturday, 2025-01-06 a Monday.
		expect(days[3].is_weekend).toBe(true);
		expect(days[5].is_weekend).toBe(false);
	});
});

describe('to_date_key', () => {
	it('zero-pads', () => {
		expect(to_date_key(2025, 3, 7)).toBe('2025-03-07');
	});
});

describe('move_in_grid', () => {
	it('steps within a month and stops at its edges', () => {
		expect(move_in_grid(2025, 1, 1, 'up')).toBeNull();
		expect(move_in_grid(2025, 1, 1, 'down')).toEqual({ month: 1, day: 2 });
		expect(move_in_grid(2025, 2, days_in_month(2025, 2), 'down')).toBeNull();
	});

	it('clamps when moving to a shorter month', () => {
		expect(move_in_grid(2025, 1, 31, 'right')).toEqual({ month: 2, day: 28 });
		expect(move_in_grid(2024, 3, 31, 'left')).toEqual({ month: 2, day: 29 });
		expect(move_in_grid(2025, 1, 5, 'left')).toBeNull();
		expect(move_in_grid(2025, 12, 5, 'right')).toBeNull();
	});
});

describe('iso_week', () => {
	it('matches ISO 8601 week numbering', () => {
		expect(iso_week(2026, 1, 1)).toBe(1);
		expect(iso_week(2027, 1, 1)).toBe(53); // Friday, belongs to week 53 of 2026
		expect(iso_week(2024, 12, 30)).toBe(1); // Monday, week 1 of 2025
		expect(iso_week(2026, 10, 17)).toBe(42);
	});
});

describe('add_days', () => {
	it('crosses month, leap day and year boundaries', () => {
		expect(add_days('2025-03-01', -1)).toBe('2025-02-28');
		expect(add_days('2024-02-28', 1)).toBe('2024-02-29');
		expect(add_days('2025-12-31', 1)).toBe('2026-01-01');
	});
});

describe('same_day_in_year', () => {
	it('clamps 29 February', () => {
		expect(same_day_in_year('2024-02-29', 2025)).toBe('2025-02-28');
		expect(same_day_in_year('2025-07-04', 2026)).toBe('2026-07-04');
	});
});

describe('parse_date_query', () => {
	const now = new Date(2026, 9, 17);
	const parse = (query: string) => parse_date_query(query, 2026, now, ['en']);

	it('understands common formats', () => {
		expect(parse('today')).toEqual({ year: 2026, month: 10, day: 17 });
		expect(parse('2027-03-14')).toEqual({ year: 2027, month: 3, day: 14 });
		expect(parse('14 mar')).toEqual({ year: 2026, month: 3, day: 14 });
		expect(parse('14. March 2028')).toEqual({ year: 2028, month: 3, day: 14 });
		expect(parse('march 14')).toEqual({ year: 2026, month: 3, day: 14 });
		expect(parse('Dec')).toEqual({ year: 2026, month: 12, day: 1 });
		expect(parse('2030')).toEqual({ year: 2030, month: 1, day: 1 });
	});

	it('rejects invalid dates and plain words', () => {
		expect(parse('30 feb')).toBeNull();
		expect(parse('2026-13-01')).toBeNull();
		expect(parse('ma')).toBeNull();
		expect(parse('vacation')).toBeNull();
		expect(parse('')).toBeNull();
	});
});
