<script lang="ts" module>
	export type GridActions = {
		clear: () => void;
		set_color: (color: TagColor | undefined) => void;
		/** Shows only days with this color; undefined shows everything again. */
		highlight: (color: TagColor | undefined) => void;
		/** Shifts the event (or selection) by `days`. */
		move: (days: number) => void;
		/** Lengthens (positive) or shortens the event (or selection) at its end. */
		resize: (days: number) => void;
		details: () => void;
		go_to: (key: string) => void;
		message: (text: string) => void;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import {
		MONTHS,
		days_in_month,
		move_in_grid,
		parse_date_key,
		same_day_in_year,
		to_date,
		to_date_key,
		today_key,
		type CalendarDay
	} from '$lib/calendar';
	import {
		MAX_TITLE_LENGTH,
		TAG_COLORS,
		TAG_HUES,
		normalize_entry,
		same_entry,
		type Entry,
		type TagColor
	} from '$lib/entries';
	import { has_mod, is_printable } from '$lib/keyboard';
	import type { Planner } from '$lib/planner.svelte';
	import { color_label } from '$lib/settings';

	type Props = {
		planner: Planner;
		year: number;
		days: CalendarDay[];
		targets: string[];
		active: string;
		anchor: string;
		actions: GridActions;
		highlight?: TagColor;
		/** Public holiday names keyed by date. */
		holidays?: Record<string, string>;
		/** Mute days before today so what's left of the year stands out. */
		fade_past?: boolean;
	};

	let {
		planner,
		year,
		days,
		targets,
		active = $bindable(),
		anchor = $bindable(),
		actions,
		highlight,
		holidays = {},
		fade_past = false
	}: Props = $props();

	type Direction = 'up' | 'down' | 'left' | 'right';

	const ARROWS: Record<string, Direction> = {
		ArrowUp: 'up',
		ArrowDown: 'down',
		ArrowLeft: 'left',
		ArrowRight: 'right'
	};

	const today = today_key();
	const full_date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
	// Month names follow the browser's language, like the weekday letters and holiday names.
	const month_names = MONTHS.map((_, i) => {
		const name = new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
			new Date(Date.UTC(2000, i, 1))
		);
		return name.charAt(0).toLocaleUpperCase() + name.slice(1);
	});
	const weekday_names = Array.from({ length: 7 }, (_, i) =>
		new Intl.DateTimeFormat(undefined, { weekday: 'short', timeZone: 'UTC' })
			.format(new Date(Date.UTC(2023, 0, 1 + i)))
			.slice(0, 2)
	);

	let calendar = $state<HTMLDivElement>();
	let editor = $state<HTMLInputElement>();
	let editing = $state<{
		keys: string[];
		key: string;
		value: string;
		/** `replace` started by typing (arrows save and move); `edit` started with Enter/F2. */
		mode: 'replace' | 'edit';
		rect: { left: number; top: number; width: number; height: number };
	} | null>(null);
	let dragging = false;
	let pending_edit = false;

	const target_set = $derived(new Set(targets));
	const is_range = $derived(targets.length > 1);

	/** Internal clipboard, so a copy/paste round trip keeps descriptions and colors. */
	let clipboard: { text: string; items: (Entry | null)[] } | null = null;

	function cell(key: string) {
		return calendar?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`) ?? null;
	}

	export async function focus_active() {
		await tick();
		cell(active)?.focus();
	}

	function select(key: string, extend = false) {
		active = key;
		if (!extend) anchor = key;
		focus_active();
	}

	function move(direction: Direction, extend: boolean) {
		const { month, day } = parse_date_key(active);
		const target = move_in_grid(year, month, day, direction);
		if (target) select(to_date_key(year, target.month, target.day), extend);
	}

	function describe(day: CalendarDay) {
		const entry = planner.entries[day.key];
		const date = full_date.format(to_date({ year, month: day.month, day: day.day }));
		const label = [date, `week ${day.week}`, holidays[day.key]].filter(Boolean).join(', ');
		if (!entry) return label;
		const category = entry.color && color_label(planner.settings, entry.color);
		return [label, entry.title || 'untitled', category].filter(Boolean).join(', ');
	}

	// ── Inline editing ───────────────────────────────────────────────────────

	export async function start_edit(mode: 'replace' | 'edit', initial?: string) {
		const element = cell(active);
		if (!element || !calendar || editing) return;

		const min_width = 16 * 16;
		const width = Math.max(element.offsetWidth, min_width);
		const left = Math.min(element.offsetLeft, calendar.scrollWidth - width);

		editing = {
			keys: targets,
			key: active,
			value: initial ?? planner.entries[active]?.title ?? '',
			mode,
			rect: { left, top: element.offsetTop, width, height: element.offsetHeight }
		};

		await tick();
		editor?.focus();
		editor?.setSelectionRange(editor.value.length, editor.value.length);
	}

	function commit_edit(then: Direction | null) {
		if (!editing) return;

		const { keys, key, value } = editing;
		editing = null;

		const base = planner.entries[key] ?? { title: '', description: '' };
		planner.set(keys, normalize_entry({ ...base, title: value }));

		if (then) {
			// Leave the edited block in the direction of travel.
			const from = then === 'down' ? keys.at(-1)! : then === 'up' ? keys[0] : key;
			const { month, day } = parse_date_key(from);
			const target = move_in_grid(year, month, day, then);
			select(target ? to_date_key(year, target.month, target.day) : key);
		} else {
			select(key);
		}
	}

	function cancel_edit() {
		if (!editing) return;
		const { key } = editing;
		editing = null;
		select(key);
	}

	function on_editor_keydown(event: KeyboardEvent) {
		if (!editing) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			cancel_edit();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			commit_edit(has_mod(event) ? null : event.shiftKey ? 'up' : 'down');
		} else if (event.key === 'Tab') {
			event.preventDefault();
			commit_edit(event.shiftKey ? 'left' : 'right');
		} else if (editing.mode === 'replace' && event.key in ARROWS && !event.shiftKey) {
			event.preventDefault();
			commit_edit(ARROWS[event.key]);
		}
	}

	// ── Keyboard ─────────────────────────────────────────────────────────────

	function on_keydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		if (editing || !target.dataset.key) return;

		const mod = has_mod(event);
		const { month } = parse_date_key(active);

		if (event.key in ARROWS && !mod && !event.altKey) {
			event.preventDefault();
			move(ARROWS[event.key], event.shiftKey);
		} else if (event.key in ARROWS && event.altKey && !mod) {
			// Alt+↑/↓ nudges by a day, Alt+←/→ by a week; with Shift the end moves instead.
			event.preventDefault();
			const days = { up: -1, down: 1, left: -7, right: 7 }[ARROWS[event.key]];
			if (event.shiftKey) actions.resize(days);
			else actions.move(days);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			const start = event.key === 'Home';
			const key = mod
				? to_date_key(year, start ? 1 : 12, start ? 1 : 31)
				: to_date_key(year, month, start ? 1 : days_in_month(year, month));
			select(key, event.shiftKey);
		} else if (event.key === 'PageUp' || event.key === 'PageDown') {
			event.preventDefault();
			actions.go_to(same_day_in_year(active, year + (event.key === 'PageUp' ? -1 : 1)));
		} else if (event.key === 'Enter' && event.shiftKey) {
			event.preventDefault();
			actions.details();
		} else if (event.key === 'Enter' || event.key === 'F2') {
			event.preventDefault();
			start_edit('edit');
		} else if (event.key === 'Escape' && anchor !== active) {
			event.preventDefault();
			anchor = active;
		} else if (event.key === 'Escape' && highlight) {
			event.preventDefault();
			actions.highlight(undefined);
		} else if (event.key === 'Delete' || event.key === 'Backspace') {
			event.preventDefault();
			actions.clear();
		} else if (event.altKey && !mod && /^Digit[0-6]$/.test(event.code)) {
			// Matched on `code` because Alt changes the produced character on macOS.
			event.preventDefault();
			const digit = Number(event.code.slice(-1));
			const color = digit === 0 ? undefined : TAG_COLORS[digit - 1];
			if (event.shiftKey) {
				actions.highlight(color === highlight ? undefined : color);
			} else {
				actions.set_color(color);
			}
		} else if (event.key === ' ' && !mod) {
			event.preventDefault();
			start_edit('edit');
		} else if (is_printable(event)) {
			event.preventDefault();
			start_edit('replace', event.key);
		}
	}

	// ── Clipboard ────────────────────────────────────────────────────────────

	function grid_has_focus() {
		const focused = document.activeElement as HTMLElement | null;
		return !editing && !!focused?.dataset.key && !!calendar?.contains(focused);
	}

	function on_copy(event: ClipboardEvent, cut = false) {
		if (!grid_has_focus() || !event.clipboardData) return;
		event.preventDefault();

		const items = targets.map((key) => planner.entries[key] ?? null);
		const text = items.map((item) => item?.title ?? '').join('\n');
		event.clipboardData.setData('text/plain', text);
		clipboard = { text, items: $state.snapshot(items) as (Entry | null)[] };

		if (cut) {
			planner.set(targets, null);
			actions.message(`Cut ${targets.length === 1 ? '1 day' : `${targets.length} days`}`);
		} else {
			actions.message(`Copied ${targets.length === 1 ? '1 day' : `${targets.length} days`}`);
		}
	}

	function on_paste(event: ClipboardEvent) {
		if (!grid_has_focus() || !event.clipboardData) return;

		const text = event.clipboardData.getData('text/plain');
		if (!text && !clipboard) return;
		event.preventDefault();

		const items: (Entry | null)[] =
			clipboard && clipboard.text === text
				? clipboard.items
				: text
						.replace(/\r/g, '')
						.replace(/\n$/, '')
						.split('\n')
						.map((line) => normalize_entry({ title: line.split('\t')[0], description: '' }));

		// One copied day fills the whole selection; otherwise paste day by day.
		const start = days.findIndex((day) => day.key === targets[0]);
		const keys =
			items.length === 1 && is_range
				? targets
				: days.slice(start, start + items.length).map((day) => day.key);

		planner.set_many(keys.map((key, i) => [key, items.length === 1 ? items[0] : items[i]]));

		anchor = keys[0];
		active = keys.at(-1)!;
		focus_active();
		actions.message(`Pasted into ${keys.length === 1 ? '1 day' : `${keys.length} days`}`);
	}
</script>

<svelte:document
	oncopy={(event) => on_copy(event)}
	oncut={(event) => on_copy(event, true)}
	onpaste={on_paste}
/>

<svelte:window onpointerup={() => (dragging = false)} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="calendar"
	bind:this={calendar}
	onkeydown={on_keydown}
	role="group"
	aria-label="{year} calendar"
	aria-describedby="grid-help"
>
	<p id="grid-help" class="visually-hidden">
		Use the arrow keys to move between days, Shift with arrows to select several days, and start
		typing to add a title. Press Control or Command plus slash for all shortcuts.
	</p>

	{#each MONTHS as key, index (key)}
		<div class="month-header" style="grid-column: {index + 1}; --hue: {index * 30};">
			{month_names[index]}
		</div>
	{/each}

	{#each days as day, i (day.key)}
		{@const entry = planner.entries[day.key]}
		{@const previous = i > 0 && days[i - 1].month === day.month ? days[i - 1] : null}
		{@const next = i < days.length - 1 && days[i + 1].month === day.month ? days[i + 1] : null}
		{@const continues = !!previous && same_entry(planner.entries[previous.key], entry)}
		{@const continued = !!next && same_entry(planner.entries[next.key], entry)}
		<!-- SvelteKit moves focus to the [autofocus] element after loading, so the calendar is
		     ready for keyboard input straight away. -->
		<!-- svelte-ignore a11y_autofocus -->
		<button
			type="button"
			class="day"
			class:weekend={day.is_weekend}
			class:holiday={!!holidays[day.key]}
			class:week-start={day.weekday === 1 && day.day !== 1}
			class:today={day.key === today}
			class:past={fade_past && day.key < today}
			class:active={day.key === active}
			class:targeted={is_range && target_set.has(day.key)}
			class:has-entry={!!entry}
			class:tagged={!!entry?.color}
			class:dimmed={!!highlight && entry?.color !== highlight}
			class:continues
			class:continued
			style="grid-column: {day.month}; grid-row: {day.day + 1};{entry?.color
				? ` --hue: ${TAG_HUES[entry.color]};`
				: ''}"
			data-key={day.key}
			tabindex={day.key === active ? 0 : -1}
			autofocus={day.key === active}
			title={entry?.description || undefined}
			aria-current={day.key === today ? 'date' : undefined}
			onpointerdown={(event) => {
				if (event.button !== 0) return;
				commit_edit(null);
				pending_edit = day.key === active && anchor === active && !event.shiftKey;
				if (event.shiftKey) {
					select(day.key, true);
				} else if (!pending_edit) {
					select(day.key);
				}
				dragging = event.pointerType === 'mouse';
			}}
			onpointerenter={(event) => {
				if (dragging && event.buttons === 1 && day.key !== active) {
					pending_edit = false;
					select(day.key, true);
				}
			}}
			onclick={() => {
				if (pending_edit) start_edit('edit');
				pending_edit = false;
			}}
		>
			<!-- The full date is the accessible name; the compact visible text is hidden from
			     assistive technology so the two can't disagree. -->
			<span class="visually-hidden">{describe(day)}</span>
			<span class="day-number" aria-hidden="true">{day.day}</span>
			<span class="weekday" aria-hidden="true">{weekday_names[day.weekday]}</span>
			<span class="title" aria-hidden="true">
				{#if entry && !continues}
					{entry.title}
				{:else if !entry && holidays[day.key]}
					<span class="holiday-name">{holidays[day.key]}</span>
				{/if}
			</span>
			{#if entry?.description && !continues}<span class="note" aria-hidden="true"></span>{/if}
			<!-- Titles matter more than week numbers when space is tight. -->
			{#if day.weekday === 1 && !(entry?.title && !continues) && !holidays[day.key]}
				<span class="week" aria-hidden="true">{day.week}</span>
			{/if}
		</button>
	{/each}

	{#if editing}
		<input
			bind:this={editor}
			bind:value={editing.value}
			class="inline-editor"
			type="text"
			maxlength={MAX_TITLE_LENGTH}
			aria-label="Title for {editing.keys.length > 1
				? `${editing.keys.length} days`
				: full_date.format(to_date(parse_date_key(editing.key)))}"
			style:left="{editing.rect.left}px"
			style:top="{editing.rect.top}px"
			style:width="{editing.rect.width}px"
			style:height="{editing.rect.height}px"
			onkeydown={on_editor_keydown}
			onblur={() => commit_edit(null)}
		/>
	{/if}
</div>

<style>
	.calendar {
		position: relative;
		display: grid;
		grid-template-columns: repeat(12, minmax(6.5rem, 1fr));
		grid-template-rows: auto repeat(31, minmax(1.4rem, 1fr));
		min-height: 100%;
		font-size: var(--fs-sm);
		background-color: var(--surface-muted);
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}

	.month-header {
		grid-row: 1;
		position: sticky;
		top: 0;
		z-index: 2;
		padding: var(--spacing-1) var(--spacing-2);
		font-weight: 600;
		border-right: 1px solid var(--border);
		background-color: oklch(var(--header-l) var(--header-c) var(--hue));
	}

	.day {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.3em;
		min-width: 0;
		padding: 0 var(--spacing-1) 0 var(--spacing-2);
		border-bottom: 1px solid var(--border);
		border-right: 1px solid var(--border);
		background-color: var(--surface);
		color: var(--text);
		text-align: left;
		overflow: hidden;
		cursor: default;
		user-select: none;

		&.weekend,
		&.holiday {
			background-color: var(--surface-muted);
		}

		/* Like a printed calendar's red days. */
		&.holiday .day-number {
			color: var(--danger);
		}

		&.week-start {
			border-top: 1px solid var(--border-strong);
		}

		&.has-entry::before {
			content: '';
			position: absolute;
			inset: 0 auto 0 0;
			width: 3px;
			background-color: var(--text-faint);
		}

		&.tagged {
			background-color: oklch(var(--tag-l) var(--tag-c) var(--hue));

			&::before {
				background-color: oklch(var(--tag-bar-l) var(--tag-bar-c) var(--hue));
			}
		}

		&.continued {
			border-bottom-color: transparent;
		}

		/* Muted, not transparent: past text keeps readable contrast. */
		&.past {
			background-color: var(--surface-muted);

			& .title {
				font-weight: 400;
				color: var(--text-muted);
			}

			&.tagged {
				background-color: oklch(var(--tag-l) calc(var(--tag-c) * 0.35) var(--hue));
			}

			&.tagged::before {
				opacity: 0.5;
			}
		}

		&.dimmed {
			color: var(--text-faint);
			background-color: var(--surface-muted);

			&::before {
				display: none;
			}

			& .title {
				font-weight: 400;
			}
		}

		&.targeted {
			box-shadow: inset 0 0 0 100vmax var(--selection);
		}

		&.active,
		&:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: -2px;
			z-index: 1;
		}

		&.today .day-number {
			color: var(--accent-contrast);
			background-color: var(--accent);
			border-radius: var(--radius-sm);
		}
	}

	.day-number {
		min-width: 2.4ch;
		padding-inline: 2px;
		font-weight: 600;
		text-align: center;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}

	.holiday-name {
		font-weight: 400;
		font-style: italic;
		color: var(--text-muted);
	}

	.weekday {
		width: 2.2ch;
		font-size: 0.85em;
		color: var(--text-faint);
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.note {
		flex-shrink: 0;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background-color: var(--text-faint);
	}

	.week {
		flex-shrink: 0;
		font-size: 0.85em;
		color: var(--text-faint);
		font-variant-numeric: tabular-nums;
	}

	.inline-editor {
		position: absolute;
		z-index: 3;
		padding: 0 var(--spacing-2);
		border: 2px solid var(--accent);
		border-radius: var(--radius-xs);
		background-color: var(--surface-raised);
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
		box-shadow: var(--shadow-lg);
		outline: none;
	}

	@media print {
		.calendar {
			grid-template-rows: auto repeat(31, 1fr);
			min-height: 0;
			height: 100%;
			font-size: 7pt;
		}

		.day,
		.month-header {
			print-color-adjust: exact;
		}

		.day.active,
		.day.targeted {
			outline: none;
			box-shadow: none;
		}

		.month-header {
			position: static;
		}
	}
</style>
