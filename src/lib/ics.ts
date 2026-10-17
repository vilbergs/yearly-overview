import { add_days } from './calendar';
import type { Entries } from './entries';
import { color_label, default_settings, type Settings } from './settings';
import { list_runs } from './selection';

function escape_text(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\r?\n/g, '\\n');
}

/** RFC 5545 lines are limited to 75 octets; continuation lines start with a space. */
function fold(line: string) {
	const encoder = new TextEncoder();
	const parts: string[] = [];
	let current = '';

	for (const char of line) {
		if (encoder.encode(current + char).length > (parts.length ? 74 : 75)) {
			parts.push(current);
			current = '';
		}
		current += char;
	}
	parts.push(current);

	return parts.join('\r\n ');
}

const compact = (key: string) => key.replaceAll('-', '');

/** Exports entries as all-day iCalendar events, merging consecutive identical days. */
export function to_ics(
	entries: Entries,
	settings: Settings = default_settings(),
	now = new Date()
) {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Yearly Overview//EN',
		'CALSCALE:GREGORIAN'
	];

	for (const { start, end, entry } of list_runs(entries)) {
		lines.push(
			'BEGIN:VEVENT',
			`UID:${compact(start)}-${compact(end)}@yearly-overview`,
			`DTSTAMP:${stamp}`,
			`DTSTART;VALUE=DATE:${compact(start)}`,
			`DTEND;VALUE=DATE:${compact(add_days(end, 1))}`,
			`SUMMARY:${escape_text(entry.title || '(untitled)')}`
		);
		if (entry.description) lines.push(`DESCRIPTION:${escape_text(entry.description)}`);
		if (entry.color) lines.push(`CATEGORIES:${escape_text(color_label(settings, entry.color))}`);
		lines.push('END:VEVENT');
	}

	lines.push('END:VCALENDAR');

	return lines.map(fold).join('\r\n') + '\r\n';
}
