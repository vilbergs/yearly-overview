export const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

export const MIN_YEAR = 1900;
export const MAX_YEAR = 9999;

export type CalendarDay = {
	/** ISO date, `YYYY-MM-DD`. Used as the storage key for entries. */
	key: string;
	/** 1-based month. */
	month: number;
	/** 1-based day of month. */
	day: number;
	/** 0 = Sunday … 6 = Saturday. */
	weekday: number;
	is_weekend: boolean;
	/** ISO 8601 week number. */
	week: number;
};

export type DateParts = { year: number; month: number; day: number };

export function is_leap_year(year: number) {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function days_in_month(year: number, month: number) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function to_date_key(year: number, month: number, day: number) {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parse_date_key(key: string): DateParts {
	const [year, month, day] = key.split('-').map(Number);
	return { year, month, day };
}

export function today_key(now = new Date()) {
	return to_date_key(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** A local `Date` for a day, safe for years below 100. */
export function to_date({ year, month, day }: DateParts) {
	const date = new Date(2000, 0, 1);
	date.setFullYear(year, month - 1, day);
	return date;
}

export function add_days(key: string, amount: number) {
	const { year, month, day } = parse_date_key(key);
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day + amount);
	return to_date_key(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function iso_week(year: number, month: number, day: number) {
	const date = new Date(Date.UTC(year, month - 1, day));
	const weekday = date.getUTCDay() || 7;
	// The ISO week belongs to the year that contains its Thursday.
	date.setUTCDate(date.getUTCDate() + 4 - weekday);
	const year_start = Date.UTC(date.getUTCFullYear(), 0, 1);
	return Math.ceil(((date.getTime() - year_start) / 86_400_000 + 1) / 7);
}

export function get_days_of_year(year: number): CalendarDay[] {
	const days: CalendarDay[] = [];

	for (let month = 1; month <= 12; month++) {
		for (let day = 1; day <= days_in_month(year, month); day++) {
			const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

			days.push({
				key: to_date_key(year, month, day),
				month,
				day,
				weekday,
				is_weekend: weekday === 0 || weekday === 6,
				week: iso_week(year, month, day)
			});
		}
	}

	return days;
}

/**
 * Moves within the month-per-column grid. Up/down step one day inside the
 * month; left/right jump to the same day in the neighbouring month, clamped to
 * that month's length. Returns null when the move would leave the year.
 */
export function move_in_grid(
	year: number,
	month: number,
	day: number,
	direction: 'up' | 'down' | 'left' | 'right'
): { month: number; day: number } | null {
	switch (direction) {
		case 'up':
			return day > 1 ? { month, day: day - 1 } : null;
		case 'down':
			return day < days_in_month(year, month) ? { month, day: day + 1 } : null;
		case 'left':
			return month > 1
				? { month: month - 1, day: Math.min(day, days_in_month(year, month - 1)) }
				: null;
		case 'right':
			return month < 12
				? { month: month + 1, day: Math.min(day, days_in_month(year, month + 1)) }
				: null;
	}
}

/** Same month and day in another year (29 February becomes the 28th). */
export function same_day_in_year(key: string, year: number) {
	const { month, day } = parse_date_key(key);
	return to_date_key(year, month, Math.min(day, days_in_month(year, month)));
}

function month_names(locale?: string) {
	const formatter = new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' });
	return Array.from({ length: 12 }, (_, i) =>
		formatter.format(new Date(Date.UTC(2000, i, 1))).toLocaleLowerCase()
	);
}

function find_month(word: string, locales: (string | undefined)[]) {
	if (word.length < 3) return null;

	for (const locale of locales) {
		const index = month_names(locale).findIndex((name) => name.startsWith(word));
		if (index !== -1) return index + 1;
	}

	return null;
}

/**
 * Understands `today`, `2026-03-14`, `14 mar`, `march 14`, `mar 14 2027`,
 * `march` and `2027`. Month names are matched in English and the browser's
 * locale. Returns null for anything else or an invalid date.
 */
export function parse_date_query(
	query: string,
	current_year: number,
	now = new Date(),
	locales: (string | undefined)[] = ['en', undefined]
): DateParts | null {
	const text = query.trim().toLocaleLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ');
	if (!text) return null;

	if (text === 'today') {
		return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
	}

	let parts: DateParts | null = null;
	let match: RegExpMatchArray | null;

	if ((match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
		parts = { year: +match[1], month: +match[2], day: +match[3] };
	} else if ((match = text.match(/^(\d{4})$/))) {
		parts = { year: +match[1], month: 1, day: 1 };
	} else if ((match = text.match(/^(\d{1,2}) ?(\p{L}+)(?: (\d{4}))?$/u))) {
		const month = find_month(match[2], locales);
		if (month) parts = { year: match[3] ? +match[3] : current_year, month, day: +match[1] };
	} else if ((match = text.match(/^(\p{L}+)(?: (\d{1,2}))?(?: (\d{4}))?$/u))) {
		const month = find_month(match[1], locales);
		if (month) {
			parts = { year: match[3] ? +match[3] : current_year, month, day: match[2] ? +match[2] : 1 };
		}
	}

	if (!parts) return null;

	const { year, month, day } = parts;
	const valid =
		year >= MIN_YEAR &&
		year <= MAX_YEAR &&
		month >= 1 &&
		month <= 12 &&
		day >= 1 &&
		day <= days_in_month(year, month);

	return valid ? parts : null;
}
