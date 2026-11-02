import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	reporter: 'line',
	use: {
		baseURL: 'http://localhost:4177',
		// System Chrome, because the bundled Chromium has no H.264 encoder for the MP4 test.
		channel: 'chrome',
		viewport: { width: 1440, height: 860 },
		launchOptions: {
			args: [
				'--use-angle=swiftshader',
				'--enable-unsafe-swiftshader',
				'--ignore-gpu-blocklist',
				'--autoplay-policy=no-user-gesture-required'
			]
		}
	},
	webServer: {
		command: 'pnpm exec vite --port 4177 --strictPort',
		url: 'http://localhost:4177',
		reuseExistingServer: true
	}
});
