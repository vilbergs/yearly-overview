<script lang="ts" module>
	export type Command = {
		id: string;
		label: string;
		shortcut?: string;
		/** Extra words the command can be found by. */
		keywords?: string;
		run: () => void;
	};
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { parse_date_key, parse_date_query, to_date, to_date_key } from '$lib/calendar';
	import { TAG_HUES, type Entries } from '$lib/entries';
	import { list_runs } from '$lib/selection';

	type Props = {
		commands: Command[];
		entries: Entries;
		year: number;
		/** Public holidays of the shown year, searchable by name. */
		holidays?: Record<string, string>;
		ongo: (key: string) => void;
		onclose: () => void;
	};

	let { commands, entries, year, holidays = {}, ongo, onclose }: Props = $props();

	type Result = {
		id: string;
		label: string;
		detail?: string;
		hue?: number;
		shortcut?: string;
		run: () => void;
	};

	const MAX_ENTRY_RESULTS = 50;
	const date_format = new Intl.DateTimeFormat(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
	const full_date = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' });

	let dialog = $state<HTMLDialogElement>();
	let list = $state<HTMLUListElement>();
	let query = $state('');
	let selected = $state(0);
	/** Run after the dialog has closed, so focus is back in the calendar first. */
	let pending: (() => void) | null = null;

	const words = $derived(query.toLocaleLowerCase().split(/\s+/).filter(Boolean));
	const matches = (text: string) => {
		const haystack = text.toLocaleLowerCase();
		return words.every((word) => haystack.includes(word));
	};

	const results = $derived.by((): Result[] => {
		const found: Result[] = [];

		const date = parse_date_query(query, year);
		if (date) {
			const key = to_date_key(date.year, date.month, date.day);
			found.push({
				id: `date-${key}`,
				label: `Go to ${full_date.format(to_date(date))}`,
				run: () => ongo(key)
			});
		}

		for (const command of commands) {
			if (matches(`${command.label} ${command.keywords ?? ''}`)) {
				found.push({ ...command, id: `command-${command.id}` });
			}
		}

		if (words.length) {
			const runs = list_runs(entries)
				.filter(({ entry }) => matches(`${entry.title} ${entry.description} ${entry.color ?? ''}`))
				.slice(0, MAX_ENTRY_RESULTS);

			for (const { start, end, entry } of runs) {
				const from = date_format.format(to_date(parse_date_key(start)));
				found.push({
					id: `entry-${start}`,
					label: entry.title || '(untitled)',
					detail:
						start === end ? from : `${from} – ${date_format.format(to_date(parse_date_key(end)))}`,
					hue: entry.color ? TAG_HUES[entry.color] : undefined,
					run: () => ongo(start)
				});
			}
		}

		if (words.length) {
			for (const [key, name] of Object.entries(holidays)) {
				if (!matches(name)) continue;
				found.push({
					id: `holiday-${key}`,
					label: name,
					detail: `Public holiday · ${date_format.format(to_date(parse_date_key(key)))}`,
					run: () => ongo(key)
				});
			}
		}

		return found;
	});

	export function show() {
		query = '';
		selected = 0;
		dialog?.showModal();
	}

	function choose(result: Result | undefined) {
		if (!result) return;
		pending = result.run;
		dialog?.close();
	}

	async function move(delta: number) {
		if (!results.length) return;
		selected = (selected + delta + results.length) % results.length;
		await tick();
		list?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
	}
</script>

<dialog
	bind:this={dialog}
	class="palette"
	aria-label="Search and commands"
	onclose={() => {
		onclose();
		pending?.();
		pending = null;
	}}
>
	<input
		type="text"
		role="combobox"
		aria-expanded="true"
		aria-controls="palette-results"
		aria-activedescendant={results[selected] ? `palette-${results[selected].id}` : undefined}
		aria-autocomplete="list"
		placeholder="Search entries, type a date (14 mar, 2027) or a command…"
		bind:value={query}
		oninput={() => (selected = 0)}
		onkeydown={(event) => {
			if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
				event.preventDefault();
				move(1);
			} else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
				event.preventDefault();
				move(-1);
			} else if (event.key === 'Enter') {
				event.preventDefault();
				choose(results[selected]);
			}
		}}
	/>

	<ul id="palette-results" role="listbox" aria-label="Results" bind:this={list}>
		{#each results as result, i (result.id)}
			<li
				id="palette-{result.id}"
				role="option"
				aria-selected={i === selected}
				onpointermove={() => (selected = i)}
				onclick={() => choose(result)}
				onkeydown={() => {}}
			>
				{#if result.hue !== undefined}
					<span class="dot" style="--hue: {result.hue}"></span>
				{/if}
				<span class="label">{result.label}</span>
				{#if result.detail}<span class="detail">{result.detail}</span>{/if}
				{#if result.shortcut}<kbd>{result.shortcut}</kbd>{/if}
			</li>
		{:else}
			<li class="empty" role="presentation">No matches</li>
		{/each}
	</ul>
</dialog>

<style>
	.palette {
		position: fixed;
		inset: 12vh auto auto 50%;
		translate: -50% 0;
		width: min(38rem, calc(100vw - 2rem));
		padding: 0;
		overflow: hidden;
	}

	input {
		width: 100%;
		padding: var(--spacing-4);
		border: none;
		border-bottom: 1px solid var(--border);
		border-radius: 0;
		background: transparent;
		font-size: var(--fs-md);
		outline: none;
	}

	ul {
		max-height: min(24rem, 60vh);
		overflow-y: auto;
		padding: var(--spacing-2);
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--spacing-3);
		padding: var(--spacing-2) var(--spacing-3);
		border-radius: var(--radius-md);
		font-size: var(--fs-sm);
		cursor: pointer;

		&[aria-selected='true'] {
			background-color: var(--selection);
		}

		&.empty {
			color: var(--text-muted);
			cursor: default;
		}
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail {
		color: var(--text-muted);
		white-space: nowrap;
	}

	.dot {
		flex-shrink: 0;
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background-color: oklch(var(--tag-bar-l) var(--tag-bar-c) var(--hue));
	}
</style>
