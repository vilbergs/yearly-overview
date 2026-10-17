import { add_days, days_in_month, parse_date_key, to_date_key } from './calendar';
import { TAG_COLORS, type TagColor } from './entries';
import type { Settings } from './settings';

/**
 * Understands "what and when" phrases typed into the command palette, e.g.
 * "Vacation jul 6-10 #holiday", "Dentist fri", "Conference week 32", "Trip jul 6 for 5 days".
 */
export type QuickAdd = {
	title: string;
	start: string;
	end: string;
	color?: TagColor;
};

const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;
const TO = String.raw`\s*(?:-|–|—|to|until|till|\.\.)\s*`;
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function month_number(name: string) {
	return (
		['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
			name.slice(0, 3).toLowerCase()
		) + 1
	);
}

function weekday_of(key: string) {
	const { year, month, day } = parse_date_key(key);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** A month/day without a year means the next time it comes around (planning looks ahead). */
function upcoming(today: string, month: number, day: number, year?: number): string | null {
	const { year: this_year } = parse_date_key(today);
	const candidate = (y: number) =>
		day >= 1 && day <= days_in_month(y, month) ? to_date_key(y, month, day) : null;
	if (year) return candidate(year);
	const this_time = candidate(this_year);
	if (this_time && this_time >= today) return this_time;
	return candidate(this_year + 1) ?? this_time;
}

/** Monday of ISO week `week`. */
function iso_week_monday(year: number, week: number) {
	const jan_4 = to_date_key(year, 1, 4);
	const monday_of_week_1 = add_days(jan_4, -((weekday_of(jan_4) + 6) % 7));
	return add_days(monday_of_week_1, (week - 1) * 7);
}

type Match = { start: string; end: string; index: number; length: number };

function find_dates(text: string, today: string): Match | null {
	const { year: this_year } = parse_date_key(today);
	const at = (match: RegExpExecArray, start: string | null, end: string | null = start) =>
		start && end && end >= start
			? { start, end, index: match.index, length: match[0].length }
			: null;
	let match: RegExpExecArray | null;

	// 2026-07-06, 2026-07-06..2026-07-10
	if (
		(match = new RegExp(String.raw`\b(\d{4}-\d{2}-\d{2})(?:${TO}(\d{4}-\d{2}-\d{2}))?\b`, 'i').exec(
			text
		))
	) {
		const valid = (key: string) => {
			const { year, month, day } = parse_date_key(key);
			return month >= 1 && month <= 12 && day >= 1 && day <= days_in_month(year, month)
				? key
				: null;
		};
		return at(match, valid(match[1]), match[2] ? valid(match[2]) : valid(match[1]));
	}

	// 6 jul - 2 aug, 6-10 jul, 6 jul
	if (
		(match = new RegExp(
			String.raw`\b${DAY}(?:\s+${MONTH})?(?:${TO}${DAY})?\s+${MONTH}(?:\s+(\d{4}))?\b`,
			'i'
		).exec(text))
	) {
		const [, d1, m1, d2, m2, y] = match;
		const year = y ? Number(y) : undefined;
		const end_month = month_number(m2);
		const start_month = m1 ? month_number(m1) : end_month;
		const start = upcoming(today, start_month, Number(d1), year);
		const end =
			d2 && start
				? upcoming(
						start,
						end_month,
						Number(d2),
						year ??
							(end_month < start_month
								? parse_date_key(start).year + 1
								: parse_date_key(start).year)
					)
				: start;
		return at(match, start, end);
	}

	// jul 6 - aug 2, jul 6-10, jul 6, jul 6 2027
	if (
		(match = new RegExp(
			String.raw`\b${MONTH}\s+${DAY}(?:${TO}(?:${MONTH}\s+)?${DAY})?(?:,?\s+(\d{4}))?\b`,
			'i'
		).exec(text))
	) {
		const [, m1, d1, m2, d2, y] = match;
		const year = y ? Number(y) : undefined;
		const start_month = month_number(m1);
		const start = upcoming(today, start_month, Number(d1), year);
		if (!d2 || !start) return at(match, start);
		const end_month = m2 ? month_number(m2) : start_month;
		const start_year = parse_date_key(start).year;
		return at(
			match,
			start,
			upcoming(start, end_month, Number(d2), end_month < start_month ? start_year + 1 : start_year)
		);
	}

	// week 32, w32, v32 (Swedish "vecka")
	if ((match = /\b(?:week|vecka|w|v)\s?(\d{1,2})\b/i.exec(text))) {
		const week = Number(match[1]);
		if (week < 1 || week > 53) return null;
		let monday = iso_week_monday(this_year, week);
		if (add_days(monday, 6) < today) monday = iso_week_monday(this_year + 1, week);
		return at(match, monday, add_days(monday, 6));
	}

	// today, tomorrow
	if ((match = /\b(today|tonight|tomorrow)\b/i.exec(text))) {
		return at(match, match[1].toLowerCase() === 'tomorrow' ? add_days(today, 1) : today);
	}

	// in 3 days, in 2 weeks
	if ((match = /\bin\s+(\d{1,3})\s+(day|week)s?\b/i.exec(text))) {
		const amount = Number(match[1]) * (match[2].toLowerCase() === 'week' ? 7 : 1);
		return at(match, add_days(today, amount));
	}

	// friday, next friday, on fri
	if (
		(match = /\b(next\s+)?(mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b/i.exec(
			text
		))
	) {
		const target = WEEKDAYS.indexOf(match[2].toLowerCase());
		const offset = (target - weekday_of(today) + 7) % 7;
		// "friday" can be today; "next friday" is always after today.
		return at(match, add_days(today, match[1] && offset === 0 ? 7 : offset));
	}

	return null;
}

function remove(text: string, index: number, length: number) {
	return `${text.slice(0, index)} ${text.slice(index + length)}`;
}

/** Resolves "#work" to a color via category names (or color names), allowing a prefix. */
function find_category(text: string, settings: Settings) {
	const match = /(?:^|\s)#([\p{L}\p{N}_-]+)/u.exec(text);
	if (!match) return null;
	const wanted = match[1].toLowerCase();
	const named = TAG_COLORS.find((color) => settings.categories[color]?.toLowerCase() === wanted);
	const by_color = TAG_COLORS.find((color) => color === wanted);
	const by_prefix = TAG_COLORS.find((color) =>
		settings.categories[color]?.toLowerCase().startsWith(wanted)
	);
	const color = named ?? by_color ?? by_prefix;
	return color ? { color, index: match.index, length: match[0].length } : null;
}

export function parse_quick_add(text: string, today: string, settings: Settings): QuickAdd | null {
	let rest = text;

	const category = find_category(rest, settings);
	if (category) rest = remove(rest, category.index, category.length);

	const dates = find_dates(rest, today);
	if (!dates) return null;
	const { start } = dates;
	let { end } = dates;
	rest = remove(rest, dates.index, dates.length);

	// "for 5 days", "for 2 weeks", "for 3 nights" (3 nights = 4 days)
	const duration = /\bfor\s+(\d{1,3})\s+(day|week|night)s?\b/i.exec(rest);
	if (duration && start === end) {
		const n = Number(duration[1]);
		const unit = duration[2].toLowerCase();
		const days = unit === 'week' ? n * 7 : unit === 'night' ? n + 1 : n;
		if (days >= 1) end = add_days(start, days - 1);
		rest = remove(rest, duration.index, duration[0].length);
	}

	const title = rest
		.replace(/\s+/g, ' ')
		.trim()
		// Words left dangling by removing the date: "Dentist on", "Trip from".
		.replace(/\s+(on|from|at|in|for|the|this|until|till|during)$/i, '')
		.replace(/^(on|from|at|in|for|the)\s+/i, '')
		.trim();

	if (!title && !category) return null;
	return { title, start, end, ...(category ? { color: category.color } : {}) };
}
