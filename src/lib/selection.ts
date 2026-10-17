import { add_days, type CalendarDay } from './calendar';
import { same_entry, type Entries, type Entry } from './entries';

export type Run = { start: string; end: string; entry: Entry };

/** Groups consecutive days with identical entries, e.g. a week-long trip, into runs. */
export function list_runs(entries: Entries): Run[] {
	const keys = Object.keys(entries).sort();
	const runs: Run[] = [];

	for (const key of keys) {
		const last = runs.at(-1);
		if (last && key === add_days(last.end, 1) && same_entry(last.entry, entries[key])) {
			last.end = key;
		} else {
			runs.push({ start: key, end: key, entry: entries[key] });
		}
	}

	return runs;
}

/** All days between anchor and active (inclusive), in calendar order. */
export function range_keys(days: CalendarDay[], index: Map<string, number>, a: string, b: string) {
	const from = index.get(a) ?? 0;
	const to = index.get(b) ?? 0;
	return days.slice(Math.min(from, to), Math.max(from, to) + 1).map((day) => day.key);
}

/** The block of identical consecutive days around `key`, limited to the visible year. */
export function run_keys(
	days: CalendarDay[],
	index: Map<string, number>,
	entries: Entries,
	key: string
) {
	const at = index.get(key);
	const entry = entries[key];
	if (at === undefined || !entry) return [key];

	let start = at;
	let end = at;
	while (start > 0 && same_entry(entries[days[start - 1].key], entry)) start--;
	while (end < days.length - 1 && same_entry(entries[days[end + 1].key], entry)) end++;

	return days.slice(start, end + 1).map((day) => day.key);
}

/**
 * The days an edit applies to: the explicit range when one is selected,
 * otherwise the whole multi-day block under the cursor (or just that day).
 */
export function target_keys(
	days: CalendarDay[],
	index: Map<string, number>,
	entries: Entries,
	anchor: string,
	active: string
) {
	return anchor === active
		? run_keys(days, index, entries, active)
		: range_keys(days, index, anchor, active);
}
