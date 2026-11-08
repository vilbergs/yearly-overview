<!-- One of Fjara's carved icons, drawn from the design system's icons.json in currentColor. -->
<script lang="ts">
	import set from '$lib/fjara-icons.json';

	let { name }: { name: keyof typeof set.icons } = $props();
</script>

<svg
	viewBox="0 0 {set.grid} {set.grid}"
	fill="none"
	stroke="currentColor"
	stroke-width={set.stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- static paths from the bundled icon set, never user input -->
	{@html set.icons[name].body}
</svg>
