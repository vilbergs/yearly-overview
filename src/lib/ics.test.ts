import { describe, expect, it } from 'vitest';
import { to_ics } from './ics';

describe('to_ics', () => {
	const ics = to_ics(
		{
			'2026-01-30': { title: 'Trip', description: '', color: 'blue' },
			'2026-01-31': { title: 'Trip', description: '', color: 'blue' },
			'2026-02-05': { title: 'Dinner; with, friends', description: 'Line 1\nLine 2' }
		},
		{ categories: { blue: 'Holiday, family' } },
		new Date(Date.UTC(2026, 9, 17, 12, 0, 0))
	);

	it('produces one all-day event per block with an exclusive end date', () => {
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
		expect(ics).toContain('DTSTART;VALUE=DATE:20260130\r\nDTEND;VALUE=DATE:20260201');
		expect(ics).toContain('DTSTAMP:20261017T120000Z');
		expect(ics).toContain('CATEGORIES:Holiday\\, family');
	});

	it('escapes text', () => {
		expect(ics).toContain('SUMMARY:Dinner\\; with\\, friends');
		expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
	});

	it('folds long lines and uses CRLF', () => {
		const long = to_ics({ '2026-01-01': { title: 'x'.repeat(200), description: '' } });
		for (const line of long.split('\r\n')) expect(line.length).toBeLessThanOrEqual(75);
		expect(long.endsWith('END:VCALENDAR\r\n')).toBe(true);
	});
});
