import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		// `cargo run` in server/ provides the API during development.
		proxy: { '/api': 'http://localhost:8080' }
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
