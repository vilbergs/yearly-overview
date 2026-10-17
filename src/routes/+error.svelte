<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>{page.status} · Yearly Overview</title>
</svelte:head>

<main class="error">
	<h1>{page.status}</h1>
	<p>{page.status === 404 ? 'This page does not exist.' : 'Something went wrong.'}</p>
	<a href={resolve('/')}>Back to the calendar</a>
</main>

<style>
	.error {
		display: grid;
		place-content: center;
		gap: var(--spacing-3);
		min-height: 100dvh;
		text-align: center;
	}

	h1 {
		font-size: var(--fs-5xl);
	}
</style>
