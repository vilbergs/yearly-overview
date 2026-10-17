<script lang="ts">
	import { tick } from 'svelte';
	import { TAG_COLORS, TAG_HUES, type TagColor } from '$lib/entries';
	import { ALT, MOD, has_mod } from '$lib/keyboard';
	import { MAX_CATEGORY_LENGTH, type Settings } from '$lib/settings';

	type Props = {
		settings: Settings;
		onsave: (categories: Settings['categories']) => void;
		onclose: () => void;
	};

	let { settings, onsave, onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let names = $state<Record<TagColor, string>>(empty());

	function empty() {
		return Object.fromEntries(TAG_COLORS.map((color) => [color, ''])) as Record<TagColor, string>;
	}

	export async function show() {
		names = { ...empty(), ...settings.categories };
		dialog?.showModal();
		await tick();
		dialog?.querySelector('input')?.focus();
	}

	function save() {
		onsave({ ...names });
		dialog?.close();
	}
</script>

<dialog bind:this={dialog} class="categories" aria-labelledby="categories-heading" {onclose}>
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
		<h2 id="categories-heading">Categories</h2>
		<p class="hint">
			Name the colors so the year reads at a glance. Press <kbd>{ALT} 1–6</kbd> in the calendar to
			tag days, <kbd>{ALT} Shift 1–6</kbd> to highlight one category.
		</p>

		<div class="rows">
			{#each TAG_COLORS as color, i (color)}
				<label style="--hue: {TAG_HUES[color]}">
					<span class="swatch" aria-hidden="true"></span>
					<span class="key"><kbd>{ALT} {i + 1}</kbd></span>
					<input
						type="text"
						bind:value={names[color]}
						maxlength={MAX_CATEGORY_LENGTH}
						placeholder={color[0].toUpperCase() + color.slice(1)}
						aria-label="Name for {color}"
					/>
				</label>
			{/each}
		</div>

		<div class="actions">
			<span class="spacer"></span>
			<button type="button" onclick={() => dialog?.close()}>Cancel</button>
			<button type="submit" class="primary">Save <kbd>{MOD}+Enter</kbd></button>
		</div>
	</form>
</dialog>

<style>
	.categories {
		width: min(26rem, calc(100vw - 2rem));
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-4);
	}

	h2 {
		font-size: var(--fs-lg);
	}

	.hint {
		color: var(--text-muted);
		font-size: var(--fs-sm);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-2);
	}

	label {
		display: grid;
		grid-template-columns: auto auto 1fr;
		align-items: center;
		gap: var(--spacing-3);
	}

	.swatch {
		width: 1.5rem;
		height: 1.5rem;
		border-radius: var(--radius-sm);
		border: 3px solid oklch(var(--tag-bar-l) var(--tag-bar-c) var(--hue));
		background-color: oklch(var(--tag-l) var(--tag-c) var(--hue));
	}

	.key {
		font-size: var(--fs-sm);
	}
</style>
