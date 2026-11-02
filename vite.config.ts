import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	base: './',
	plugins: [svelte()],
	test: {
		include: ['tests/*.test.ts'],
		environment: 'node'
	}
});
