import { describe, expect, it } from 'vitest';
import { parse_quick_add } from './quick-add';

// A Saturday.
const TODAY = '2026-10-17';
const settings = { categories: { green: 'Holiday', red: 'Work', orange: 'Health' } };
const parse = (text: string) => parse_quick_add(text, TODAY, settings);

describe('parse_quick_add', () => {
	it('reads month-first dates and ranges', () => {
		expect(parse('Vacation jul 6-10 2027 #holiday')).toEqual({
			title: 'Vacation',
			start: '2027-07-06',
			end: '2027-07-10',
			color: 'green'
		});
		expect(parse('Trip dec 30 - jan 2')).toMatchObject({ start: '2026-12-30', end: '2027-01-02' });
		expect(parse('Conference November 3rd to 5th')).toMatchObject({
			title: 'Conference',
			start: '2026-11-03',
			end: '2026-11-05'
		});
	});

	it('reads day-first dates and ranges', () => {
		expect(parse('Midsummer 19 jun 2027')).toMatchObject({
			start: '2027-06-19',
			end: '2027-06-19'
		});
		expect(parse('Ski week 6-10 feb')).toMatchObject({ start: '2027-02-06', end: '2027-02-10' });
		expect(parse('Interrail 28 jun - 12 jul 2027')).toMatchObject({
			start: '2027-06-28',
			end: '2027-07-12'
		});
	});

	it('puts dates without a year in the future', () => {
		expect(parse('Party oct 20')).toMatchObject({ start: '2026-10-20' });
		expect(parse('Kickoff jan 5')).toMatchObject({ start: '2027-01-05' });
		expect(parse('Today’s thing oct 17')).toMatchObject({ start: '2026-10-17' });
	});

	it('reads ISO dates', () => {
		expect(parse('Release 2026-11-02..2026-11-04')).toMatchObject({
			title: 'Release',
			start: '2026-11-02',
			end: '2026-11-04'
		});
		expect(parse('Nope 2026-02-30')).toBeNull();
	});

	it('reads relative days and weekdays', () => {
		expect(parse('Gym today')).toMatchObject({ title: 'Gym', start: '2026-10-17' });
		expect(parse('Gym tomorrow')).toMatchObject({ start: '2026-10-18' });
		expect(parse('Dentist on friday #health')).toEqual({
			title: 'Dentist',
			start: '2026-10-23',
			end: '2026-10-23',
			color: 'orange'
		});
		expect(parse('Brunch sat')).toMatchObject({ start: '2026-10-17' });
		expect(parse('Brunch next saturday')).toMatchObject({ start: '2026-10-24' });
		expect(parse('Follow-up in 2 weeks')).toMatchObject({
			title: 'Follow-up',
			start: '2026-10-31'
		});
	});

	it('reads ISO weeks, including the Swedish "v"', () => {
		expect(parse('Conference week 44')).toMatchObject({ start: '2026-10-26', end: '2026-11-01' });
		expect(parse('Sportlov v8')).toMatchObject({ start: '2027-02-22', end: '2027-02-28' });
	});

	it('reads durations', () => {
		expect(parse('Trip jul 6 for 5 days')).toMatchObject({
			title: 'Trip',
			start: '2027-07-06',
			end: '2027-07-10'
		});
		expect(parse('Hotel nov 2 for 3 nights')).toMatchObject({ end: '2026-11-05' });
		expect(parse('Course nov 2 for 2 weeks')).toMatchObject({ end: '2026-11-15' });
	});

	it('resolves categories by name, color or prefix', () => {
		expect(parse('Standup mon #work')?.color).toBe('red');
		expect(parse('Standup mon #blue')?.color).toBe('blue');
		expect(parse('Run mon #heal')?.color).toBe('orange');
		expect(parse('Run mon #unknown')).toMatchObject({ title: 'Run #unknown' });
	});

	it('needs both something to add and a date', () => {
		expect(parse('Vacation')).toBeNull();
		expect(parse('jul 6')).toBeNull();
		expect(parse('#holiday jul 6-10')).toMatchObject({ title: '', color: 'green' });
		expect(parse('Trip jul 10-6')).toBeNull();
	});
});
