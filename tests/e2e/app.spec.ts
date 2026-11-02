import { expect, test, type Page } from '@playwright/test';

const timeline = (page: Page) => page.getByRole('slider', { name: 'Timeline' });
const stepInput = (page: Page) => page.getByRole('spinbutton').first();

async function open(page: Page, query = 'example=three-tier&theme=survey'): Promise<string[]> {
	const problems: string[] = [];
	page.on('pageerror', (error) => problems.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') problems.push(message.text());
	});
	await page.goto(`/?${query}`);
	await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Cutaway');
	await expect(timeline(page)).toBeVisible();
	return problems;
}

async function pause(page: Page): Promise<void> {
	const button = page.getByRole('button', { name: 'Pause', exact: true });
	if (await button.isVisible()) await button.click();
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

async function scrub(page: Page, time: number): Promise<void> {
	await timeline(page).evaluate((element: HTMLInputElement, value) => {
		element.value = String(value);
		element.dispatchEvent(new Event('input', { bubbles: true }));
	}, time);
}

async function canvasShot(page: Page): Promise<Buffer> {
	await page.waitForTimeout(350);
	return page.locator('canvas').screenshot();
}

test('loads every example with no errors and draws something', async ({ page }) => {
	const problems = await open(page);
	await pause(page);
	for (const id of ['oidc', 'upload', 'deploy', 'state', 'domain', 'three-tier']) {
		await page.goto(`/?example=${id}`);
		await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible();
		await expect(page.locator('ol button').first()).toBeVisible();
	}
	expect(problems).toEqual([]);
});

test('play, pause and step controls drive the timeline', async ({ page }) => {
	await open(page);
	await pause(page);

	const before = Number(await timeline(page).inputValue());
	await page.waitForTimeout(600);
	expect(Number(await timeline(page).inputValue())).toBe(before);

	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(async () => Number(await timeline(page).inputValue())).toBeGreaterThan(before);
	await pause(page);

	await stepInput(page).fill('5');
	await stepInput(page).press('Tab');
	await expect(page.locator('[aria-current="step"]')).toContainText('Passes valid session');

	await page.getByRole('button', { name: 'Next step' }).click();
	await expect(page.locator('[aria-current="step"]')).toContainText('Sends order payload');
	await page.getByRole('button', { name: 'Previous step' }).click();
	await expect(page.locator('[aria-current="step"]')).toContainText('Passes valid session');

	await page.locator('ol button', { hasText: 'Writes order events' }).click();
	await expect(page.locator('[aria-current="step"]')).toContainText('Writes order events');
});

test('a paused step button plays that step and then stops on its boundary', async ({ page }) => {
	await open(page);
	await pause(page);
	await page.locator('ol button', { hasText: 'Taps Checkout' }).click();
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.locator('[aria-current="step"]')).toContainText(/Taps Checkout|Opens payment/);
});

test('seeking is deterministic, whichever direction it comes from', async ({ page }) => {
	await open(page);
	await pause(page);
	await page.getByRole('button', { name: 'View', exact: true }).click();
	await page.getByRole('switch', { name: 'Gentle drift' }).click();
	await page.getByRole('button', { name: 'View', exact: true }).click();

	await scrub(page, 27.3);
	const forward = await canvasShot(page);
	await scrub(page, 40);
	const elsewhere = await canvasShot(page);
	await scrub(page, 3);
	await canvasShot(page);
	await scrub(page, 27.3);
	const again = await canvasShot(page);

	expect(forward.equals(elsewhere)).toBe(false);
	expect(forward.equals(again)).toBe(true);
});

test('zoom, layer pan and isometric all change the picture, and follow can be restored', async ({
	page
}) => {
	await open(page);
	await pause(page);
	await page.getByRole('button', { name: 'View', exact: true }).click();
	await page.getByRole('switch', { name: 'Gentle drift' }).click();
	await page.getByRole('button', { name: 'View', exact: true }).click();
	await scrub(page, 10);
	const base = await canvasShot(page);

	await page.getByRole('button', { name: 'Zoom in' }).click();
	await page.waitForTimeout(500);
	const zoomed = await canvasShot(page);
	expect(zoomed.equals(base)).toBe(false);
	await page.getByRole('button', { name: 'Reset camera' }).click();
	await page.waitForTimeout(900);

	await page.getByRole('button', { name: 'Pan down a layer' }).click();
	await page.waitForTimeout(1400);
	const panned = await canvasShot(page);
	expect(panned.equals(base)).toBe(false);

	const follow = page.getByRole('button', { name: 'Follow the story' });
	await expect(follow).toBeVisible();
	await follow.click();
	await expect(follow).toBeHidden();

	await page.keyboard.press('i');
	await page.waitForTimeout(400);
	const iso = await canvasShot(page);
	expect(iso.equals(base)).toBe(false);
});

test('hiding a layer removes its steps, and showing it restores them', async ({ page }) => {
	await open(page);
	await pause(page);
	const rows = page.locator('ol > li');
	const all = await rows.count();
	await page.getByRole('button', { name: 'Hide Infrastructure' }).click();
	await expect.poll(() => rows.count()).toBeLessThan(all);
	await page.getByRole('button', { name: 'Show Infrastructure' }).click();
	await expect.poll(() => rows.count()).toBe(all);
});

test('live sound fires while playing, and stops when muted', async ({ page }) => {
	await page.addInitScript(() => {
		const original = AudioContext.prototype.createOscillator;
		const counter = { oscillators: 0 };
		(window as unknown as { counter: typeof counter }).counter = counter;
		AudioContext.prototype.createOscillator = function (this: AudioContext) {
			counter.oscillators++;
			return original.call(this);
		};
	});
	await open(page);
	const count = () =>
		page.evaluate(
			() => (window as unknown as { counter: { oscillators: number } }).counter.oscillators
		);

	await pause(page);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await scrub(page, 3);
	await expect.poll(count, { timeout: 30_000 }).toBeGreaterThan(5);

	await page.getByRole('button', { name: 'Mute', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Unmute' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const muted = await count();
	await page.waitForTimeout(4000);
	expect(await count()).toBe(muted);
});

test('editing the source updates the scene, and errors keep the last good one', async ({
	page
}) => {
	await open(page);
	await pause(page);
	await page.getByRole('button', { name: 'Diagram' }).click();
	const editor = page.getByRole('textbox', { name: 'Diagram text' });

	await editor.fill('flowchart LR\nA[Unclosed --> B');
	await expect(page.getByRole('status').filter({ hasText: 'Line 2' })).toContainText(
		'never closes'
	);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Placing an order, from tap to disk'
	);

	await editor.fill(
		'sequenceDiagram\n  title: Made up here\n  box Top\n    actor U as User\n  end\n  box Low\n    participant D as Database\n  end\n  U->>D: Reads a row\n  D-->>U: 500 failed'
	);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made up here');
	await expect(page.locator('ol > li')).toHaveCount(2);
	await expect(page.getByRole('button', { name: 'Hide Low' })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made up here');
});

test('a theme changes the interface, survives a reload, and can be customised', async ({
	page
}) => {
	await open(page, 'example=oidc');
	await page.evaluate(() => localStorage.clear());
	await page.goto('/?example=oidc');
	await page.getByRole('button', { name: 'Theme', exact: true }).click();
	await page.getByRole('button', { name: 'Blueprint' }).click();
	const panel = () =>
		page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--panel'));
	await expect.poll(panel).toBe('#123F8F');

	await page.reload();
	await expect.poll(panel).toBe('#123F8F');

	await page.getByRole('button', { name: 'Theme', exact: true }).click();
	await page.getByLabel('Layer 1 colour').evaluate((element: HTMLInputElement) => {
		element.value = '#ff00aa';
		element.dispatchEvent(new Event('input', { bubbles: true }));
	});
	await page.getByRole('button', { name: 'Show current theme' }).click();
	await expect(page.getByRole('textbox', { name: 'Theme JSON' })).toHaveValue(/"#ff00aa"/);
	await expect(page.getByRole('textbox', { name: 'Theme JSON' })).toHaveValue(/"id": "custom"/);
});

async function runExport(
	page: Page,
	format: string,
	options: { step?: boolean; size?: string } = {}
): Promise<string> {
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('radio', { name: format }).check();
	if (options.size) await dialog.getByLabel('Size').selectOption(options.size);
	if (options.step) {
		const whole = dialog.getByRole('switch', { name: 'Whole walkthrough' });
		if ((await whole.getAttribute('aria-checked')) === 'true') await whole.click();
		await dialog.getByLabel('From step').fill('1');
		await dialog.getByLabel('To step').fill('1');
	}
	const downloaded = page.waitForEvent('download', { timeout: 110_000 });
	await dialog.getByRole('button', { name: /^Export / }).click();
	const download = await downloaded;
	await expect(dialog.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
	return download.suggestedFilename();
}

const resultUrl = (page: Page) => page.getByRole('dialog').getByRole('link').getAttribute('href');

test('exports a real MP4 with picture and sound', async ({ page }) => {
	await open(page);
	await pause(page);
	const name = await runExport(page, 'MP4 video', { step: true, size: '1280x720' });
	expect(name).toBe('placing-an-order-from-tap-to-disk.mp4');

	const report = await page.evaluate(
		async (url) => {
			const video = document.createElement('video');
			video.src = url!;
			video.muted = true;
			await new Promise((resolve, reject) => {
				video.onloadeddata = resolve;
				video.onerror = () => reject(new Error(video.error?.message ?? 'video failed'));
			});
			video.currentTime = video.duration / 2;
			await new Promise((resolve) => (video.onseeked = resolve));
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth;
			canvas.height = video.videoHeight;
			const context = canvas.getContext('2d')!;
			context.drawImage(video, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const colours = new Set<number>();
			for (let index = 0; index < pixels.length; index += 4000) {
				colours.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
			}
			const bytes = await (await fetch(url!)).arrayBuffer();
			const audio = await new OfflineAudioContext(2, 48000, 48000).decodeAudioData(bytes);
			let peak = 0;
			for (const sample of audio.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
			return {
				width: video.videoWidth,
				height: video.videoHeight,
				duration: video.duration,
				colours: colours.size,
				audioSeconds: audio.duration,
				peak
			};
		},
		await resultUrl(page)
	);

	expect(report.width).toBe(1280);
	expect(report.height).toBe(720);
	expect(report.duration).toBeGreaterThan(1);
	expect(report.colours).toBeGreaterThan(50);
	expect(report.audioSeconds).toBeGreaterThan(1);
	expect(report.peak).toBeGreaterThan(0.01);
});

test('exports WebM, GIF, PNG and SVG in their real formats', async ({ page }) => {
	await open(page);
	await pause(page);

	expect(await runExport(page, 'WebM video', { step: true, size: '1280x720' })).toMatch(/\.webm$/);
	const webmHead = await page.evaluate(
		async (url) => [...new Uint8Array(await (await fetch(url!)).arrayBuffer()).slice(0, 4)],
		await resultUrl(page)
	);
	expect(webmHead).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

	expect(await runExport(page, 'Animated GIF', { step: true, size: '480x270' })).toMatch(/\.gif$/);
	const gif = await page.evaluate(
		async (url) => {
			const bytes = new Uint8Array(await (await fetch(url!)).arrayBuffer());
			const image = new Image();
			image.src = url!;
			await image.decode();
			let frames = 0;
			for (let index = 0; index < bytes.length - 3; index++) {
				if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04)
					frames++;
			}
			return {
				head: String.fromCharCode(...bytes.slice(0, 6)),
				width: image.naturalWidth,
				height: image.naturalHeight,
				frames
			};
		},
		await resultUrl(page)
	);
	expect(gif.head).toBe('GIF89a');
	expect(gif.width).toBe(480);
	expect(gif.height).toBe(270);
	expect(gif.frames).toBeGreaterThan(5);
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

	expect(await runExport(page, 'PNG of this frame')).toMatch(/\.png$/);
	const png = await page.evaluate(
		async (url) => [...new Uint8Array(await (await fetch(url!)).arrayBuffer()).slice(1, 4)],
		await resultUrl(page)
	);
	expect(String.fromCharCode(...png)).toBe('PNG');
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

	expect(await runExport(page, 'SVG drawing')).toMatch(/\.svg$/);
	const svg = await page.evaluate(
		async (url) => (await (await fetch(url!)).text()).slice(0, 4),
		await resultUrl(page)
	);
	expect(svg).toBe('<svg');
});

test('cancelling an export restores the player', async ({ page }) => {
	await open(page);
	await pause(page);
	await page.getByRole('button', { name: 'Export', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /^Export / }).click();
	await dialog.getByRole('button', { name: 'Cancel export' }).click();
	await expect(dialog.getByRole('button', { name: /^Export / })).toBeVisible({ timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Close' }).click();
	await scrub(page, 20);
	await expect(page.locator('[aria-current="step"]')).toBeVisible();
	const shot = await page.locator('canvas').screenshot();
	expect(shot.length).toBeGreaterThan(5000);
});

test('loop restarts at the end, and without it playback stops', async ({ page }) => {
	await open(page, 'example=upload&theme=survey');
	await pause(page);
	const duration = Number(await timeline(page).getAttribute('max'));

	// Wait for Pause first. Play is still showing until the next frame, so checking it alone races.
	await scrub(page, duration - 1.5);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({
		timeout: 20_000
	});
	expect(Number(await timeline(page).inputValue())).toBeCloseTo(duration, 0);

	await page.getByRole('button', { name: 'Loop' }).click();
	await scrub(page, duration - 0.3);
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	await expect
		.poll(async () => Number(await timeline(page).inputValue()), { timeout: 20_000 })
		.toBeLessThan(duration / 2);
	await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('a glow theme exports a picture rather than a black frame', async ({ page }) => {
	await open(page, 'example=oidc&theme=shaft');
	await pause(page);
	await scrub(page, 24);
	await page.waitForTimeout(400);
	await runExport(page, 'PNG of this frame');
	const colours = await page.evaluate(
		async (url) => {
			const image = new Image();
			image.src = url!;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;
			const context = canvas.getContext('2d')!;
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const seen = new Set<number>();
			for (let index = 0; index < pixels.length; index += 2000) {
				seen.add((pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]);
			}
			return seen.size;
		},
		await resultUrl(page)
	);
	expect(colours).toBeGreaterThan(100);
	await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('canvas')).toBeVisible();
});

test('without WebGL it shows a static drawing, and SVG export still works', async ({ page }) => {
	await page.addInitScript(() => {
		const original = HTMLCanvasElement.prototype.getContext;
		HTMLCanvasElement.prototype.getContext = function (
			this: HTMLCanvasElement,
			type: string,
			...rest: unknown[]
		) {
			if (type.includes('webgl')) return null;
			return (original as (...args: unknown[]) => unknown).call(this, type, ...rest);
		} as typeof original;
	});
	await page.goto('/?example=three-tier&theme=survey');
	await expect(page.getByText('This browser has WebGL turned off')).toBeVisible();
	await expect(page.locator('.fallback svg')).toBeVisible();
	await expect(page.locator('.fallback svg')).toContainText('Application load balancer');
	await page.getByRole('button', { name: 'Play', exact: true }).click();
	expect(await runExport(page, 'SVG drawing')).toMatch(/\.svg$/);
});

test('works on a phone-sized screen', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 780 });
	const problems = await open(page);
	await pause(page);
	await expect(page.getByRole('complementary', { name: 'Layers and steps' })).toBeHidden();
	await page.getByRole('button', { name: 'Steps' }).click();
	await expect(page.getByRole('complementary', { name: 'Layers and steps' })).toBeVisible();
	await page.locator('ol button').nth(3).click();
	await expect(page.locator('[aria-current="step"]')).toBeVisible();
	await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^(Play|Pause)$/ })).toBeInViewport();
	expect(problems).toEqual([]);
});
