<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		MAX_YEAR,
		MIN_YEAR,
		days_in_month,
		get_days_of_year,
		local_month_names,
		parse_date_key,
		same_day_in_year,
		to_date,
		to_date_key,
		today_key
	} from '$lib/calendar';
	import {
		STORAGE_KEY,
		TAG_COLORS,
		TAG_HUES,
		export_backup,
		get_browser_storage,
		normalize_entry,
		parse_backup,
		type Entry,
		type TagColor
	} from '$lib/entries';
	import { to_ics } from '$lib/ics';
	import { ALT, MOD, has_mod, is_printable, is_text_field } from '$lib/keyboard';
	import { Planner } from '$lib/planner.svelte';
	import {
		SETTINGS_KEY,
		color_label,
		has_categories,
		has_settings,
		normalize_settings,
		type Settings
	} from '$lib/settings';
	import { STATUS_LABELS, SYNC_KEY, Sync } from '$lib/sync.svelte';
	import { target_keys } from '$lib/selection';
	import {
		HIDDEN_MONTHS_KEY,
		load_hidden_months,
		nearest_visible_month,
		save_hidden_months
	} from '$lib/view';
	import CategoriesDialog from '$lib/components/CategoriesDialog.svelte';
	import HolidaysDialog from '$lib/components/HolidaysDialog.svelte';
	import { get_holidays } from '$lib/holidays';
	import CommandPalette, { type Command } from '$lib/components/CommandPalette.svelte';
	import EntryDialog from '$lib/components/EntryDialog.svelte';
	import ShortcutsDialog from '$lib/components/ShortcutsDialog.svelte';
	import YearGrid, { type GridActions } from '$lib/components/YearGrid.svelte';

	const storage = get_browser_storage();
	const planner = new Planner(storage);
	const sync = new Sync(planner, storage);

	onMount(() => sync.start());

	let update_ready = $state(false);
	onMount(() => {
		// A new service worker took over after a deploy; the running page is the old version.
		const had_controller = !!navigator.serviceWorker?.controller;
		const on_change = () => {
			if (had_controller) update_ready = true;
		};
		navigator.serviceWorker?.addEventListener('controllerchange', on_change);
		return () => navigator.serviceWorker?.removeEventListener('controllerchange', on_change);
	});
	const today = today_key();
	const current_year = parse_date_key(today).year;

	let year = $state(current_year);
	let active = $state(today);
	let anchor = $state(today);

	const month_names = local_month_names();
	let hidden_months_by_year = $state(load_hidden_months(storage));
	const hidden_months = $derived(hidden_months_by_year[year] ?? []);

	const days = $derived(get_days_of_year(year));
	const key_index = $derived(new Map(days.map((day, i) => [day.key, i])));
	const targets = $derived(target_keys(days, key_index, planner.entries, anchor, active));
	const active_entry = $derived(planner.entries[active]);
	const active_week = $derived(days[key_index.get(active) ?? 0]?.week);

	let grid = $state<YearGrid>();
	let entry_dialog = $state<EntryDialog>();
	let palette = $state<CommandPalette>();
	let shortcuts = $state<ShortcutsDialog>();
	let categories = $state<CategoriesDialog>();
	let holidays_dialog = $state<HolidaysDialog>();
	let holidays = $state<Record<string, string>>({});

	// Load the chosen country's holidays for the shown year (the library is fetched on demand).
	$effect(() => {
		const country = planner.settings.holiday_country;
		const shown_year = year;
		if (!country) {
			holidays = {};
			return;
		}

		let stale = false;
		get_holidays(country, shown_year).then(
			(result) => {
				if (!stale) holidays = result;
			},
			() => {
				if (!stale) holidays = {};
			}
		);
		return () => {
			stale = true;
		};
	});
	let highlight = $state<TagColor | undefined>();
	let file_input = $state<HTMLInputElement>();
	let menu = $state<HTMLDetailsElement>();

	let message = $state('');
	let message_timer: ReturnType<typeof setTimeout> | undefined;

	const full_date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });
	const short_date = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

	const plural_days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

	function format_key(key: string, format = full_date) {
		return format.format(to_date(parse_date_key(key)));
	}

	function span_label(keys: string[]) {
		if (keys.length === 1) return format_key(keys[0]);
		return `${format_key(keys[0], short_date)} – ${format_key(keys.at(-1)!, short_date)} · ${plural_days(keys.length)}`;
	}

	function show_message(text: string) {
		message = text;
		clearTimeout(message_timer);
		message_timer = setTimeout(() => (message = ''), 4000);
	}

	async function go_to(key: string, range_start = key) {
		const { year: target_year, month: target_month } = parse_date_key(key);
		if (target_year < MIN_YEAR || target_year > MAX_YEAR) return;

		// Going to a day (search, undo, today) brings back its month if it was hidden.
		const hidden = hidden_months_by_year[target_year] ?? [];
		if (hidden.includes(target_month)) {
			set_hidden_months(
				target_year,
				hidden.filter((month) => month !== target_month)
			);
		}

		year = target_year;
		active = key;
		anchor = parse_date_key(range_start).year === target_year ? range_start : key;
		await tick();
		grid?.focus_active();
	}

	function focus_grid() {
		grid?.focus_active();
	}

	// ── Hidden months ────────────────────────────────────────────────────────

	function set_hidden_months(for_year: number, months: number[]) {
		const next = { ...hidden_months_by_year };
		if (months.length) next[for_year] = [...new Set(months)].sort((a, b) => a - b);
		else delete next[for_year];
		hidden_months_by_year = next;
		save_hidden_months(storage, next);
	}

	/** Hides months of the shown year, moving the cursor out of them. */
	function hide_months(months: number[]) {
		const hidden = [...new Set([...hidden_months, ...months])];
		if (hidden.length >= 12) {
			show_message('At least one month stays visible');
			return false;
		}

		set_hidden_months(year, hidden);
		const { month, day } = parse_date_key(active);
		if (hidden.includes(month)) {
			const target = nearest_visible_month(month, hidden);
			active = to_date_key(year, target, Math.min(day, days_in_month(year, target)));
		}
		if (hidden.includes(parse_date_key(anchor).month)) anchor = active;
		focus_grid();
		return true;
	}

	function hide_month(month: number) {
		if (hide_months([month])) {
			show_message(`${month_names[month - 1]} hidden · click its column to show it again`);
		}
	}

	function hide_past_months() {
		const past = month_names
			.map((_, i) => i + 1)
			.filter((month) => month < parse_date_key(today).month);
		if (hide_months(past)) show_message('Past months hidden');
	}

	function show_month(month: number) {
		set_hidden_months(
			year,
			hidden_months.filter((hidden) => hidden !== month)
		);
		focus_grid();
	}

	function show_all_months() {
		set_hidden_months(year, []);
		show_message('All months shown');
		focus_grid();
	}

	// ── Actions shared by the keyboard, the palette and the toolbar ──────────

	function clear() {
		const changed = planner.set(targets, null);
		if (changed.length) show_message(`Cleared ${plural_days(changed.length)} · ${MOD}+Z to undo`);
	}

	function set_color(color: TagColor | undefined) {
		planner.set(targets, (current) =>
			normalize_entry({ ...(current ?? { title: '', description: '' }), color })
		);
		show_message(
			color
				? `Tagged ${plural_days(targets.length)} ${color_label(planner.settings, color)}`
				: 'Color removed'
		);
	}

	function toggle_highlight(color: TagColor | undefined) {
		highlight = color;
		if (color) {
			const count = Object.values(planner.entries).filter((entry) => entry.color === color).length;
			show_message(
				`Highlighting ${color_label(planner.settings, color)} (${plural_days(count)}) · Esc to clear`
			);
		}
	}

	function save_categories(names: Settings['categories']) {
		planner.set_settings({ ...planner.settings, categories: names });
		show_message('Categories saved');
	}

	function edit_details() {
		entry_dialog?.show(targets, span_label(targets), active_entry);
	}

	function save_details(keys: string[], entry: Entry | null) {
		planner.set(keys, entry);
		if (!entry) show_message(`Cleared ${plural_days(keys.length)} · ${MOD}+Z to undo`);
	}

	function undo() {
		const changed = planner.undo();
		if (changed.length) {
			go_to(changed.at(-1)!, changed[0]);
			show_message(`Undid change to ${plural_days(changed.length)}`);
		}
	}

	function redo() {
		const changed = planner.redo();
		if (changed.length) {
			go_to(changed.at(-1)!, changed[0]);
			show_message(`Redid change to ${plural_days(changed.length)}`);
		}
	}

	function download(filename: string, content: string, type: string) {
		const url = URL.createObjectURL(new Blob([content], { type }));
		const link = document.createElement('a');
		link.href = url;
		link.download = filename;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function export_json() {
		const snapshot = $state.snapshot(planner.entries);
		download(
			`yearly-overview-${today}.json`,
			export_backup(snapshot, $state.snapshot(planner.settings)),
			'application/json'
		);
		show_message(`Backup downloaded (${plural_days(Object.keys(snapshot).length)})`);
	}

	function export_calendar() {
		download(
			`yearly-overview-${today}.ics`,
			to_ics($state.snapshot(planner.entries), $state.snapshot(planner.settings) as Settings),
			'text/calendar'
		);
		show_message(
			'Calendar file downloaded. Import it into Google Calendar, Outlook or Apple Calendar.'
		);
	}

	async function import_json(file: File) {
		const backup = parse_backup(await file.text());
		if (!backup) {
			show_message('That file is not a Yearly Overview backup.');
			return;
		}

		const changed = planner.set_many(Object.entries(backup.entries));
		// Only what the backup actually contains replaces the current settings.
		const imported = normalize_settings(backup.settings);
		if (has_settings(imported)) {
			planner.set_settings({
				categories: has_categories(imported) ? imported.categories : planner.settings.categories,
				holiday_country: imported.holiday_country ?? planner.settings.holiday_country
			});
		}
		show_message(`Imported ${plural_days(changed.length)} · ${MOD}+Z to undo`);
		focus_grid();
	}

	const actions: GridActions = {
		clear,
		set_color,
		highlight: toggle_highlight,
		details: edit_details,
		go_to: (key) => go_to(key),
		message: show_message,
		hide_month,
		show_month
	};

	const sync_commands = $derived.by((): Command[] =>
		sync.status === 'unavailable'
			? []
			: [{ id: 'sync-now', label: 'Sync now', keywords: 'refresh server', run: sync_now }]
	);

	async function sync_now() {
		await sync.sync();
		show_message(sync.status === 'synced' ? 'Synced' : sync.message || STATUS_LABELS[sync.status]);
	}

	const base_commands: Command[] = [
		{ id: 'today', label: 'Go to today', run: () => go_to(today) },
		{
			id: 'next-year',
			label: 'Next year',
			shortcut: 'Page Down',
			run: () => go_to(same_day_in_year(active, year + 1))
		},
		{
			id: 'previous-year',
			label: 'Previous year',
			shortcut: 'Page Up',
			run: () => go_to(same_day_in_year(active, year - 1))
		},
		{ id: 'details', label: 'Edit details…', shortcut: 'Shift+Enter', run: edit_details },
		{
			id: 'color-none',
			label: 'Remove color',
			shortcut: `${ALT}+0`,
			keywords: 'tag category',
			run: () => set_color(undefined)
		},
		{
			id: 'holidays',
			label: 'Public holidays…',
			keywords: 'country region red days',
			run: () => holidays_dialog?.show()
		},
		{
			id: 'categories',
			label: 'Name categories…',
			keywords: 'colors tags legend labels',
			run: () => categories?.show()
		},
		{
			id: 'clear',
			label: 'Clear selected days',
			shortcut: 'Delete',
			keywords: 'delete remove',
			run: clear
		},
		{ id: 'undo', label: 'Undo', shortcut: `${MOD}+Z`, run: undo },
		{ id: 'redo', label: 'Redo', shortcut: `${MOD}+Shift+Z`, run: redo },
		{
			id: 'export',
			label: 'Download backup (.json)',
			keywords: 'export save',
			run: export_json
		},
		{
			id: 'import',
			label: 'Restore backup…',
			keywords: 'import load open',
			run: () => file_input?.click()
		},
		{
			id: 'ics',
			label: 'Export to calendar app (.ics)',
			keywords: 'ical google outlook apple',
			run: export_calendar
		},
		{ id: 'print', label: 'Print', keywords: 'pdf', run: () => window.print() },
		{
			id: 'shortcuts',
			label: 'Keyboard shortcuts',
			shortcut: `${MOD}+/`,
			keywords: 'help keys',
			run: () => shortcuts?.show()
		}
	];

	// Category names can change, so these are rebuilt.
	const category_commands = $derived.by((): Command[] => {
		const commands: Command[] = TAG_COLORS.flatMap((color, i) => {
			const label = color_label(planner.settings, color);
			return [
				{
					id: `color-${color}`,
					label: `Tag: ${label}`,
					shortcut: `${ALT}+${i + 1}`,
					keywords: `color category ${color}`,
					run: () => set_color(color)
				},
				{
					id: `highlight-${color}`,
					label: `Highlight: ${label}`,
					shortcut: `${ALT}+Shift+${i + 1}`,
					keywords: `show only filter ${color}`,
					run: () => toggle_highlight(color)
				}
			];
		});
		if (highlight) {
			commands.unshift({
				id: 'highlight-none',
				label: 'Clear highlight',
				shortcut: 'Esc',
				keywords: 'show all',
				run: () => toggle_highlight(undefined)
			});
		}
		return commands;
	});

	const month_commands = $derived.by((): Command[] => {
		const active_month = parse_date_key(active).month;
		const commands: Command[] = [];
		if (hidden_months.length < 11) {
			commands.push({
				id: 'hide-month',
				label: `Hide ${month_names[active_month - 1]}`,
				keywords: 'collapse month column',
				run: () => hide_month(active_month)
			});
		}
		if (year === current_year && parse_date_key(today).month > 1) {
			commands.push({
				id: 'hide-past-months',
				label: 'Hide past months',
				keywords: 'collapse month columns earlier',
				run: hide_past_months
			});
		}
		for (const month of hidden_months) {
			commands.push({
				id: `show-month-${month}`,
				label: `Show ${month_names[month - 1]}`,
				keywords: 'hidden month column expand',
				run: () => show_month(month)
			});
		}
		if (hidden_months.length > 1) {
			commands.push({
				id: 'show-all-months',
				label: 'Show all months',
				keywords: 'hidden month columns expand',
				run: show_all_months
			});
		}
		return commands;
	});

	const commands = $derived([
		...base_commands,
		...month_commands,
		...category_commands,
		...sync_commands
	]);

	function on_window_keydown(event: KeyboardEvent) {
		const mod = has_mod(event);
		const key = event.key.toLowerCase();
		const dialog_open = !!document.querySelector('dialog[open]');

		if (mod && key === 'k') {
			event.preventDefault();
			if (!dialog_open) palette?.show();
		} else if (mod && (key === '/' || event.code === 'Slash')) {
			event.preventDefault();
			if (!dialog_open) shortcuts?.show();
		} else if (dialog_open || is_text_field(event.target)) {
			// Let dialogs and text fields keep their native behaviour (including undo).
		} else if (mod && key === 'z') {
			event.preventDefault();
			if (event.shiftKey) redo();
			else undo();
		} else if (mod && key === 'y') {
			event.preventDefault();
			redo();
		} else if (event.target === document.body && !mod && !event.altKey) {
			// Nothing focused (e.g. after clicking the background): send keys back to the calendar.
			if (is_printable(event)) {
				event.preventDefault();
				grid?.start_edit('replace', event.key);
			} else {
				focus_grid();
			}
		}
	}
</script>

<svelte:head>
	<title>{year} · Yearly Overview</title>
</svelte:head>

<svelte:window
	onkeydown={on_window_keydown}
	onstorage={(event) => {
		// Keep multiple open tabs in sync.
		if (event.key === STORAGE_KEY || event.key === SETTINGS_KEY) planner.reload();
		if (event.key === SYNC_KEY) sync.storage_changed();
		if (event.key === HIDDEN_MONTHS_KEY) hidden_months_by_year = load_hidden_months(storage);
	}}
/>

<header class="toolbar">
	<nav class="year-nav" aria-label="Year">
		<button
			type="button"
			class="icon"
			aria-label="Previous year"
			title="Previous year (Page Up)"
			disabled={year <= MIN_YEAR}
			onclick={() => go_to(same_day_in_year(active, year - 1))}>‹</button
		>
		<h1>{year}</h1>
		<button
			type="button"
			class="icon"
			aria-label="Next year"
			title="Next year (Page Down)"
			disabled={year >= MAX_YEAR}
			onclick={() => go_to(same_day_in_year(active, year + 1))}>›</button
		>
		<button type="button" onclick={() => go_to(today)}>Today</button>
	</nav>

	{#if has_categories(planner.settings)}
		<ul class="legend" aria-label="Categories">
			{#each TAG_COLORS as color (color)}
				{#if planner.settings.categories[color]}
					<li>
						<button
							type="button"
							style="--hue: {TAG_HUES[color]}"
							aria-pressed={highlight === color}
							title="Highlight {color_label(planner.settings, color)}"
							onclick={() => {
								toggle_highlight(highlight === color ? undefined : color);
								focus_grid();
							}}
						>
							<span class="swatch" aria-hidden="true"></span>
							{color_label(planner.settings, color)}
						</button>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}

	<span class="spacer"></span>

	{#if sync.status !== 'unavailable'}
		<button
			type="button"
			class="sync"
			data-status={sync.status}
			aria-label="Sync: {STATUS_LABELS[sync.status]}{sync.pending
				? ` (${sync.pending} waiting)`
				: ''}. Sync now"
			onclick={sync_now}
			title={sync.message || 'Sync now'}
		>
			<span class="dot" aria-hidden="true"></span>
			<span class="label">
				{STATUS_LABELS[sync.status]}{#if sync.pending}&nbsp;· {sync.pending}{/if}
			</span>
		</button>
	{/if}

	<button type="button" class="search" onclick={() => palette?.show()}>
		<span>Search, go to date, commands</span>
		<kbd>{MOD} K</kbd>
	</button>

	<details class="menu" bind:this={menu}>
		<summary>More</summary>
		<div class="menu-items">
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					categories?.show();
				}}>Name categories…</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					holidays_dialog?.show();
				}}>Public holidays…</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					export_json();
				}}>Download backup</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					file_input?.click();
				}}>Restore backup…</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					export_calendar();
				}}>Export to calendar (.ics)</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					window.print();
				}}>Print</button
			>
			<button
				type="button"
				onclick={() => {
					menu!.open = false;
					shortcuts?.show();
				}}>Keyboard shortcuts <kbd>{MOD} /</kbd></button
			>
		</div>
	</details>

	<input
		bind:this={file_input}
		type="file"
		accept=".json,application/json"
		hidden
		onchange={(event) => {
			const file = event.currentTarget.files?.[0];
			event.currentTarget.value = '';
			if (file) import_json(file);
		}}
	/>
</header>

<main class="scroller">
	<h2 class="print-only">{year}</h2>
	<YearGrid
		bind:this={grid}
		bind:active
		bind:anchor
		{planner}
		{year}
		{days}
		{targets}
		{actions}
		{highlight}
		{holidays}
		{hidden_months}
	/>
</main>

<footer class="status">
	<div class="current">
		<strong>{span_label(targets.length > 1 && anchor !== active ? targets : [active])}</strong>
		{#if anchor === active}<span class="muted">Week {active_week}</span>{/if}
		{#if anchor === active && holidays[active]}
			<span class="holiday">{holidays[active]}</span>
		{/if}
		{#if active_entry}
			<span class="entry">
				{#if active_entry.title}<span class="entry-title">{active_entry.title}</span>{/if}
				{#if active_entry.description}<span class="muted">{active_entry.description}</span>{/if}
			</span>
		{/if}
	</div>

	<div class="aside">
		{#if update_ready}
			<span role="status">
				A new version is available.
				<button type="button" class="link" onclick={() => location.reload()}>Reload</button>
			</span>
		{:else if planner.save_failed && !sync.connected}
			<span class="warning" role="alert">
				Your browser is blocking storage. Changes will be lost when you leave. Download a backup to
				keep them.
			</span>
		{:else if message}
			<span role="status">{message}</span>
		{:else if highlight}
			<span class="hints">
				Highlighting {color_label(planner.settings, highlight)} · <kbd>Esc</kbd> show all
			</span>
		{:else if anchor !== active}
			<span class="hints">
				Type to fill · <kbd>{ALT} 1–6</kbd> color · <kbd>Del</kbd> clear · <kbd>Esc</kbd> deselect
			</span>
		{:else}
			<span class="hints">
				Type to add · <kbd>Shift Enter</kbd> details · <kbd>{MOD} K</kbd> search ·
				<kbd>{MOD} /</kbd> shortcuts
			</span>
		{/if}
	</div>
</footer>

<EntryDialog
	bind:this={entry_dialog}
	settings={planner.settings}
	onsave={save_details}
	onclose={focus_grid}
/>
<CommandPalette
	bind:this={palette}
	{commands}
	entries={planner.entries}
	{year}
	{holidays}
	ongo={(key) => go_to(key)}
	onclose={focus_grid}
/>
<ShortcutsDialog bind:this={shortcuts} onclose={focus_grid} />
<HolidaysDialog
	bind:this={holidays_dialog}
	value={planner.settings.holiday_country}
	onsave={(country) => {
		planner.set_settings({ ...planner.settings, holiday_country: country });
		show_message(country ? 'Public holidays shown' : 'Public holidays hidden');
	}}
	onclose={focus_grid}
/>
<CategoriesDialog
	bind:this={categories}
	settings={planner.settings}
	onsave={save_categories}
	onclose={focus_grid}
/>

<style>
	:global(body) {
		display: flex;
		flex-direction: column;
		height: 100dvh;
		min-height: 0;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--spacing-2) var(--spacing-3);
		padding: var(--spacing-2) var(--spacing-4);
		border-bottom: 1px solid var(--border);
		background-color: var(--surface);
	}

	.year-nav {
		display: flex;
		align-items: center;
		gap: var(--spacing-1);

		& h1 {
			min-width: 4ch;
			font-size: var(--fs-xl);
			text-align: center;
			font-variant-numeric: tabular-nums;
		}

		& .icon {
			padding-inline: var(--spacing-2);
			font-size: var(--fs-lg);
			line-height: 1.2;
		}

		& button:disabled {
			opacity: 0.4;
		}
	}

	.spacer {
		flex: 1;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-1);
		list-style: none;

		& button {
			gap: var(--spacing-1);
			padding: 0 var(--spacing-2);
			border-color: transparent;
			font-size: var(--fs-xs);

			&[aria-pressed='true'] {
				border-color: var(--accent);
				background-color: var(--selection);
			}
		}

		& .swatch {
			width: 0.7rem;
			height: 0.7rem;
			border-radius: 3px;
			background-color: oklch(var(--tag-bar-l) var(--tag-bar-c) var(--hue));
		}
	}

	.sync {
		& .dot {
			width: 0.55rem;
			height: 0.55rem;
			border-radius: 50%;
			background-color: var(--text-faint);
		}

		&[data-status='synced'] .dot {
			background-color: oklch(0.65 0.17 150);
		}

		&[data-status='syncing'] .dot {
			background-color: var(--accent);
		}

		&[data-status='offline'] .dot,
		&[data-status='error'] .dot {
			background-color: var(--warning);
		}
	}

	.search {
		min-width: min(20rem, 100%);
		justify-content: space-between;
		color: var(--text-muted);
	}

	.menu {
		position: relative;

		& summary {
			list-style: none;
			cursor: pointer;

			&::-webkit-details-marker {
				display: none;
			}
		}
	}

	.menu-items {
		position: absolute;
		right: 0;
		top: calc(100% + var(--spacing-1));
		z-index: 10;
		display: flex;
		flex-direction: column;
		min-width: 15rem;
		padding: var(--spacing-1);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-lg);
		background-color: var(--surface-raised);
		box-shadow: var(--shadow-lg);

		& button {
			justify-content: space-between;
			border: none;
			background: transparent;
			text-align: left;

			&:hover,
			&:focus-visible {
				background-color: var(--selection);
			}
		}
	}

	.scroller {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}

	.status {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--spacing-1) var(--spacing-4);
		min-height: 2.5rem;
		padding: var(--spacing-1) var(--spacing-4);
		border-top: 1px solid var(--border);
		background-color: var(--surface);
		font-size: var(--fs-sm);
	}

	.current {
		display: flex;
		align-items: baseline;
		gap: var(--spacing-3);
		min-width: 0;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
	}

	.entry {
		display: flex;
		gap: var(--spacing-2);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.holiday {
		color: var(--danger);
	}

	.entry-title {
		font-weight: 600;
	}

	.muted,
	.hints {
		color: var(--text-muted);
	}

	.link {
		border: none;
		background: none;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.warning {
		color: var(--warning);
		font-weight: 500;
	}

	.print-only {
		display: none;
	}

	@media (max-width: 40rem) {
		.toolbar {
			flex-wrap: nowrap;
			padding-inline: var(--spacing-2);
		}

		.spacer,
		.legend,
		.search kbd,
		.sync .label,
		.hints {
			display: none;
		}

		.search {
			flex: 1;
			min-width: 0;

			& span {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}
		}
	}

	@media print {
		.print-only {
			display: block;
			margin-bottom: 2mm;
			font-size: 14pt;
		}

		@page {
			size: landscape;
			margin: 8mm;
		}

		:global(body) {
			height: auto;
		}

		.toolbar,
		.status {
			display: none;
		}

		.scroller {
			height: calc(100vh - 12mm);
			overflow: visible;
		}
	}
</style>
