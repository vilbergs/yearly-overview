<script lang="ts">
	import { tick } from 'svelte';
	import { guess_country, list_countries, type Country } from '$lib/holidays';

	type Props = {
		/** The current setting (`SE`, `DE-BY`) or undefined for none. */
		value: string | undefined;
		onsave: (country: string | undefined) => void;
		onclose: () => void;
	};

	let { value, onsave, onclose }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	let countries = $state<Country[] | null>(null);
	let failed = $state(false);
	let country = $state('');
	let region = $state('');

	const regions = $derived(countries?.find((item) => item.code === country)?.regions ?? []);

	export async function show() {
		failed = false;
		dialog?.showModal();
		try {
			countries ??= await list_countries();
		} catch {
			failed = true;
			return;
		}

		const [code, sub] = (value ?? '').split('-');
		country = value ? code : (guess_country(countries) ?? '');
		region = sub ? value! : '';
		await tick();
		dialog?.querySelector('select')?.focus();
	}

	function save() {
		onsave(country ? region || country : undefined);
		dialog?.close();
	}
</script>

<dialog bind:this={dialog} class="holidays" aria-labelledby="holidays-heading" {onclose}>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			save();
		}}
	>
		<h2 id="holidays-heading">Public holidays</h2>
		<p class="hint">Holidays are shaded like weekends and named on days without an entry.</p>

		{#if failed}
			<p class="error" role="alert">Couldn’t load the list of countries. Check your connection.</p>
		{:else if !countries}
			<p role="status">Loading countries…</p>
		{:else}
			<div class="field">
				<label for="holiday-country">Country</label>
				<select id="holiday-country" bind:value={country} onchange={() => (region = '')}>
					<option value="">No holidays</option>
					{#each countries as item (item.code)}
						<option value={item.code}>{item.name}</option>
					{/each}
				</select>
			</div>
			{#if regions.length}
				<div class="field">
					<label for="holiday-region">Region</label>
					<select id="holiday-region" bind:value={region} aria-describedby="holiday-region-hint">
						<option value="">Whole country</option>
						{#each regions as item (item.code)}
							<option value={item.code}>{item.name}</option>
						{/each}
					</select>
					<small id="holiday-region-hint">Some holidays only apply in part of the country.</small>
				</div>
			{/if}
		{/if}

		<p class="credit">
			Holiday data from <a
				href="https://github.com/commenthol/date-holidays"
				target="_blank"
				rel="noreferrer">date-holidays</a
			> (CC BY 3.0).
		</p>

		<div class="actions">
			<span class="spacer"></span>
			<button type="button" onclick={() => dialog?.close()}>Cancel</button>
			<button type="submit" class="primary" disabled={!countries}>Save</button>
		</div>
	</form>
</dialog>

<style>
	.holidays {
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

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--spacing-1);
	}

	label {
		font-size: var(--fs-sm);
		font-weight: 500;
	}

	select {
		padding: var(--spacing-2);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-md);
		background-color: var(--surface);
		color: var(--text);
		font-size: var(--fs-md);
	}

	.hint,
	small,
	.credit {
		color: var(--text-muted);
		font-size: var(--fs-sm);
		font-weight: 400;
	}

	.credit {
		font-size: var(--fs-xs);
	}

	.error {
		color: var(--danger);
	}
</style>
