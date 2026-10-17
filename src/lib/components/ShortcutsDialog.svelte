<script lang="ts">
	import { SHORTCUTS } from '$lib/keyboard';

	let { onclose }: { onclose: () => void } = $props();
	let dialog = $state<HTMLDialogElement>();

	export function show() {
		dialog?.showModal();
	}
</script>

<dialog bind:this={dialog} class="shortcuts" aria-labelledby="shortcuts-heading" {onclose}>
	<header>
		<h2 id="shortcuts-heading">Keyboard shortcuts</h2>
		<button type="button" onclick={() => dialog?.close()}>Close <kbd>Esc</kbd></button>
	</header>

	<div class="groups">
		{#each SHORTCUTS as group (group.title)}
			<section>
				<h3>{group.title}</h3>
				<dl>
					{#each group.shortcuts as shortcut (shortcut.label)}
						<dt>
							{#each shortcut.keys as combo, i (i)}
								{#if i > 0}<span class="or">/</span>{/if}
								{#each combo as key, j (j)}{#if j > 0}+{/if}<kbd>{key}</kbd>{/each}
							{/each}
						</dt>
						<dd>{shortcut.label}</dd>
					{/each}
				</dl>
			</section>
		{/each}
	</div>
</dialog>

<style>
	.shortcuts {
		width: min(52rem, calc(100vw - 2rem));
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--spacing-4);

		& h2 {
			font-size: var(--fs-lg);
		}
	}

	.groups {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr));
		gap: var(--spacing-6);
	}

	h3 {
		margin-bottom: var(--spacing-2);
		font-size: var(--fs-sm);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: var(--spacing-2) var(--spacing-4);
		align-items: baseline;
		font-size: var(--fs-sm);
	}

	dt {
		white-space: nowrap;
		text-align: right;
	}

	.or {
		margin-inline: var(--spacing-1);
		color: var(--text-faint);
	}
</style>
