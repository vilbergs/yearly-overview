<script lang="ts">
	import { tick } from 'svelte';
	import {
		MAX_DESCRIPTION_LENGTH,
		MAX_TITLE_LENGTH,
		TAG_COLORS,
		TAG_HUES,
		normalize_entry,
		type Entry,
		type TagColor
	} from '$lib/entries';
	import { ALT, MOD, has_mod } from '$lib/keyboard';
	import { color_label, type Settings } from '$lib/settings';

	type Props = {
		settings: Settings;
		onsave: (keys: string[], entry: Entry | null) => void;
		onclose: () => void;
	};

	let { settings, onsave, onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let form = $state<{
		keys: string[];
		heading: string;
		exists: boolean;
		title: string;
		description: string;
		color: TagColor | '';
	} | null>(null);

	export async function show(keys: string[], heading: string, entry: Entry | undefined) {
		form = {
			keys,
			heading,
			exists: !!entry,
			title: entry?.title ?? '',
			description: entry?.description ?? '',
			color: entry?.color ?? ''
		};
		await tick();
		dialog?.showModal();
	}

	function save() {
		if (!form) return;
		onsave(
			form.keys,
			normalize_entry({
				title: form.title,
				description: form.description,
				color: form.color || undefined
			})
		);
		dialog?.close();
	}

	function remove() {
		if (!form) return;
		onsave(form.keys, null);
		dialog?.close();
	}
</script>

<dialog
	bind:this={dialog}
	class="entry-dialog"
	aria-labelledby="entry-dialog-heading"
	onclose={() => {
		form = null;
		onclose();
	}}
>
	{#if form}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<form
			onsubmit={(event) => {
				event.preventDefault();
				save();
			}}
			onkeydown={(event) => {
				if (event.key === 'Enter' && has_mod(event)) {
					event.preventDefault();
					save();
				}
			}}
		>
			<h2 id="entry-dialog-heading">{form.heading}</h2>

			<label>
				<span>Title</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input type="text" bind:value={form.title} maxlength={MAX_TITLE_LENGTH} autofocus />
			</label>

			<label>
				<span>Description</span>
				<textarea bind:value={form.description} maxlength={MAX_DESCRIPTION_LENGTH} rows="5"
				></textarea>
			</label>

			<fieldset>
				<legend>Color <small>{ALT}+1–7 in the calendar</small></legend>
				<div class="swatches">
					<label class="swatch none">
						<input type="radio" name="color" value="" bind:group={form.color} />
						<span>None</span>
					</label>
					{#each TAG_COLORS as color (color)}
						<label
							class="swatch"
							class:named={!!settings.categories[color]}
							style="--hue: {TAG_HUES[color]}"
						>
							<input type="radio" name="color" value={color} bind:group={form.color} />
							{#if settings.categories[color]}
								<span class="name">{color_label(settings, color)}</span>
							{:else}
								<span class="visually-hidden">{color}</span>
							{/if}
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="actions">
				{#if form.exists}
					<button type="button" class="danger" onclick={remove}>Delete</button>
				{/if}
				<span class="spacer"></span>
				<button type="button" onclick={() => dialog?.close()}>Cancel</button>
				<button type="submit" class="primary">Save <kbd>{MOD}+Enter</kbd></button>
			</div>
		</form>
	{/if}
</dialog>

<style>
	.entry-dialog {
		width: min(28rem, calc(100vw - 2rem));
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-4);
	}

	h2 {
		font-size: var(--fs-md);
	}

	label:not(.swatch) {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1);
		font-size: var(--fs-sm);
		font-weight: 500;
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2);
	}

	legend {
		margin-bottom: var(--spacing-2);
		font-size: var(--fs-sm);
		font-weight: 500;
	}

	small {
		margin-left: var(--spacing-2);
		color: var(--text-faint);
		font-weight: 400;
	}

	.swatches {
		display: flex;
		flex-wrap: wrap;
		gap: var(--spacing-2);
	}

	.swatch {
		position: relative;
		display: grid;
		place-items: center;
		min-width: 2rem;
		height: 2rem;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-strong);
		background-color: oklch(var(--tag-l) var(--tag-c) var(--hue));
		font-size: var(--fs-xs);
		cursor: pointer;

		&.none {
			padding-inline: var(--spacing-2);
			background-color: var(--surface);
		}

		& input {
			position: absolute;
			opacity: 0;
		}

		&:has(input:checked) {
			outline: 2px solid var(--accent);
			outline-offset: 2px;
		}

		&:has(input:focus-visible) {
			outline: 3px solid var(--accent);
			outline-offset: 2px;
		}

		&.named {
			display: flex;
			gap: var(--spacing-2);
			padding-inline: var(--spacing-2);
		}

		& .name {
			order: 1;
			font-size: var(--fs-sm);
		}

		&:not(.none)::after {
			content: '';
			width: 0.75rem;
			height: 0.75rem;
			border-radius: 50%;
			background-color: oklch(var(--tag-bar-l) var(--tag-bar-c) var(--hue));
		}
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
