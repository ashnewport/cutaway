<script lang="ts">
	import { onMount } from 'svelte';
	import { renderSvg } from '../core/index.ts';
	import {
		ExportCancelled,
		exportGif,
		exportPng,
		exportVideo,
		probeVideoSupport,
		type ExportOptions,
		type VideoSupport
	} from '../stage/export.ts';
	import { app } from './app.svelte.ts';
	import Toggle from './Toggle.svelte';

	type Format = 'mp4' | 'webm' | 'gif' | 'png' | 'svg';

	const VIDEO_SIZES = [
		{ id: '1920x1080', name: '1920 by 1080, landscape', width: 1920, height: 1080 },
		{ id: '1280x720', name: '1280 by 720, landscape', width: 1280, height: 720 },
		{ id: '1080x1080', name: '1080 by 1080, square', width: 1080, height: 1080 },
		{ id: '1080x1920', name: '1080 by 1920, vertical', width: 1080, height: 1920 }
	];
	const GIF_SIZES = [
		{ id: '480x270', name: '480 by 270, small file', width: 480, height: 270 },
		{ id: '640x360', name: '640 by 360', width: 640, height: 360 },
		{ id: '800x450', name: '800 by 450, large file', width: 800, height: 450 }
	];

	let dialog = $state<HTMLDialogElement>();
	let format = $state<Format>('mp4');
	let videoSize = $state('1280x720');
	let gifSize = $state('640x360');
	let videoFps = $state(30);
	let gifFps = $state(12);
	let includeAudio = $state(true);
	let burnCaptions = $state(true);
	let wholeThing = $state(true);
	let fromStep = $state(1);
	let chosenLastStep = $state<number | null>(null);
	let support = $state<VideoSupport | null>(null);

	let working = $state(false);
	let fraction = $state(0);
	let status = $state('');
	let result = $state<{ url: string; name: string; note: string } | null>(null);
	let failure = $state('');
	let controller: AbortController | null = null;

	const steps = $derived(app.compiled?.script.steps ?? []);
	const toStep = $derived(chosenLastStep ?? Math.max(1, steps.length));
	const isGif = $derived(format === 'gif');
	const isVideo = $derived(format === 'mp4' || format === 'webm');
	const isAnimated = $derived(isVideo || isGif);
	const sizes = $derived(isGif ? GIF_SIZES : VIDEO_SIZES);
	const fps = $derived(isGif ? gifFps : videoFps);
	const chosen = $derived(
		sizes.find((size) => size.id === (isGif ? gifSize : videoSize)) ?? sizes[0]
	);
	const formatDisabled = $derived<Record<Format, string>>({
		mp4: support && !support.mp4 ? 'This browser cannot encode MP4' : '',
		webm: support && !support.webm ? 'This browser cannot encode WebM' : '',
		gif: '',
		png: '',
		svg: ''
	});

	const clip = $derived.by(() => {
		if (wholeThing || steps.length === 0) return app.duration;
		const first = steps[Math.max(0, fromStep - 1)];
		const last = steps[Math.min(steps.length - 1, Math.max(fromStep, toStep) - 1)];
		return first && last ? last.end - first.start : app.duration;
	});

	onMount(() => {
		void probeVideoSupport(1280, 720).then((found) => {
			support = found;
			if (format === 'mp4' && !found.mp4) format = found.webm ? 'webm' : 'gif';
		});
	});

	$effect(() => {
		if (!dialog) return;
		if (app.exportOpen && !dialog.open) dialog.showModal();
		else if (!app.exportOpen && dialog.open) dialog.close();
	});

	function download(blob: Blob, name: string, note: string): void {
		if (result) URL.revokeObjectURL(result.url);
		const url = URL.createObjectURL(blob);
		result = { url, name, note };
		const link = document.createElement('a');
		link.href = url;
		link.download = name;
		link.click();
	}

	function size(bytes: number): string {
		return bytes > 1048576
			? `${(bytes / 1048576).toFixed(1)} MB`
			: `${Math.max(1, Math.round(bytes / 1024))} KB`;
	}

	function fileName(extension: string): string {
		const title = app.compiled?.scene.diagram.title ?? 'cutaway';
		const slug =
			title
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'cutaway';
		return `${slug}.${extension}`;
	}

	async function run(): Promise<void> {
		const stage = app.stage;
		const compiled = app.compiled;
		failure = '';
		if (!compiled) return;

		if (format === 'svg') {
			const svg = renderSvg(compiled.scene, app.theme);
			const blob = new Blob([svg], { type: 'image/svg+xml' });
			download(blob, fileName('svg'), `Isometric drawing, ${size(blob.size)}.`);
			return;
		}
		if (!stage) {
			failure =
				'This format needs WebGL, which this browser has turned off. The SVG format still works.';
			return;
		}

		const options: ExportOptions = {
			format: format === 'webm' ? 'webm' : format === 'gif' ? 'gif' : 'mp4',
			width: chosen.width,
			height: chosen.height,
			fps,
			audio: includeAudio && !app.muted,
			captions: burnCaptions,
			fromStep: wholeThing ? 0 : fromStep - 1,
			toStep: wholeThing ? steps.length - 1 : Math.max(fromStep, toStep) - 1,
			theme: app.theme,
			title: compiled.scene.diagram.title,
			pack: app.sound.pack,
			ambience: app.ambience,
			volume: app.volume
		};

		if (format === 'png') {
			const blob = await exportPng(stage, options, app.time);
			download(blob, fileName('png'), `Current frame, ${size(blob.size)}.`);
			return;
		}

		working = true;
		fraction = 0;
		status = 'Starting';
		controller = new AbortController();
		const onProgress = (value: number, label: string): void => {
			fraction = value;
			status = label;
		};
		try {
			const run = format === 'gif' ? exportGif : exportVideo;
			const done = await run(stage, options, onProgress, controller.signal);
			download(
				done.blob,
				done.filename,
				`${done.seconds.toFixed(1)} seconds, ${done.frames} frames, ${done.codec}, ${size(done.blob.size)}.`
			);
		} catch (error) {
			if (!(error instanceof ExportCancelled)) {
				console.error(error);
				failure = (error as Error).message;
			}
		} finally {
			working = false;
			controller = null;
		}
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="export-title"
	oncancel={(event) => {
		if (working) event.preventDefault();
		else app.exportOpen = false;
	}}
>
	<h2 id="export-title">Export</h2>

	<fieldset disabled={working}>
		<legend>Format</legend>
		<div class="formats">
			{#each [['mp4', 'MP4 video'], ['webm', 'WebM video'], ['gif', 'Animated GIF'], ['png', 'PNG of this frame'], ['svg', 'SVG drawing']] as [id, name] (id)}
				<label
					class={{ off: Boolean(formatDisabled[id as Format]) }}
					title={formatDisabled[id as Format]}
				>
					<input
						type="radio"
						name="format"
						value={id}
						bind:group={format}
						disabled={Boolean(formatDisabled[id as Format])}
					/>
					{name}
				</label>
			{/each}
		</div>
	</fieldset>

	{#if format !== 'svg'}
		<div class="pair">
			<label class="field">
				Size
				{#if isGif}
					<select bind:value={gifSize} disabled={working}>
						{#each GIF_SIZES as option (option.id)}<option value={option.id}>{option.name}</option
							>{/each}
					</select>
				{:else}
					<select bind:value={videoSize} disabled={working}>
						{#each VIDEO_SIZES as option (option.id)}<option value={option.id}>{option.name}</option
							>{/each}
					</select>
				{/if}
			</label>
			{#if isVideo}
				<label class="field">
					Frame rate
					<select bind:value={videoFps} disabled={working}>
						<option value={24}>24 per second</option>
						<option value={30}>30 per second</option>
						<option value={60}>60 per second</option>
					</select>
				</label>
			{:else if isGif}
				<label class="field">
					Frame rate
					<select bind:value={gifFps} disabled={working}>
						<option value={8}>8 per second</option>
						<option value={12}>12 per second</option>
						<option value={20}>20 per second</option>
					</select>
				</label>
			{/if}
		</div>

		<Toggle
			label="Burn in captions"
			checked={burnCaptions}
			onchange={(on) => (burnCaptions = on)}
		/>
		{#if isVideo}
			<Toggle
				label="Include sound"
				hint={app.muted ? 'Sound is muted, so this file will be silent' : undefined}
				checked={includeAudio}
				onchange={(on) => (includeAudio = on)}
			/>
		{/if}
	{/if}

	{#if isAnimated}
		<Toggle label="Whole walkthrough" checked={wholeThing} onchange={(on) => (wholeThing = on)} />
		{#if !wholeThing}
			<div class="pair">
				<label class="field"
					>From step <input
						type="number"
						min="1"
						max={steps.length}
						bind:value={fromStep}
						disabled={working}
					/></label
				>
				<label class="field"
					>To step <input
						type="number"
						min={fromStep}
						max={steps.length}
						value={toStep}
						oninput={(event) => (chosenLastStep = Number(event.currentTarget.value))}
						disabled={working}
					/></label
				>
			</div>
		{/if}
		<p class="estimate">
			This clip runs {clip.toFixed(1)} seconds, which is {Math.ceil(clip * fps)} frames.
		</p>
		{#if isGif && clip > 20}
			<p class="estimate">
				A GIF this long will be a very large file. A short step range works better, or use video.
			</p>
		{/if}
	{/if}

	{#if working}
		<div
			class="progress"
			role="progressbar"
			aria-label="Export progress"
			aria-valuemin="0"
			aria-valuemax="100"
			aria-valuenow={Math.round(fraction * 100)}
		>
			<span style:width="{fraction * 100}%"></span>
		</div>
		<p class="estimate" role="status">{status}</p>
	{/if}
	{#if failure}<p class="problem" role="alert">{failure}</p>{/if}
	{#if result && !working}
		<p class="done" role="status">
			<!-- This is a blob URL for a file just made here, not a route, so resolve() cannot apply. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			Saved <a href={result.url} download={result.name}>{result.name}</a>. {result.note}
		</p>
	{/if}

	<div class="actions">
		{#if working}
			<button class="action" type="button" onclick={() => controller?.abort()}>Cancel export</button
			>
		{:else}
			<button class="action" type="button" onclick={() => (app.exportOpen = false)}>Close</button>
			<button class="action primary" type="button" onclick={run}
				>Export {format.toUpperCase()}</button
			>
		{/if}
	</div>
</dialog>

<style>
	dialog {
		width: min(460px, calc(100vw - 24px));
		padding: 18px 20px;
		border: 1px solid var(--rule);
		border-radius: var(--r);
		background: var(--panel);
		color: var(--ink);
	}

	dialog::backdrop {
		background: color-mix(in srgb, var(--ink), transparent 55%);
	}

	h2 {
		margin: 0 0 12px;
		font-family: var(--font-display);
		font-size: 22px;
		font-stretch: 118%;
		font-weight: 700;
	}

	fieldset {
		margin: 0 0 12px;
		padding: 0;
		border: 0;
	}

	legend {
		margin-bottom: 4px;
		padding: 0;
		color: var(--ink-soft);
		font-size: 13px;
	}

	.formats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px 12px;
	}

	.formats label {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.formats .off {
		opacity: 0.45;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-bottom: 8px;
	}

	.pair select,
	.pair input {
		width: 100%;
	}

	.estimate {
		margin: 6px 0;
		color: var(--ink-soft);
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.progress {
		height: 8px;
		margin-top: 10px;
		background: var(--rule);
	}

	.progress span {
		display: block;
		height: 100%;
		background: var(--packet);
	}

	.problem,
	.done {
		margin: 8px 0;
		font-size: 13px;
	}

	.done a {
		color: inherit;
		font-weight: 620;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 12px;
	}

	.action {
		height: 36px;
		padding: 0 14px;
		border: 1px solid var(--rule);
		border-radius: var(--r);
		background: none;
		font-weight: 600;
	}

	.primary {
		border-color: var(--ink);
		background: var(--ink);
		color: var(--panel);
	}
</style>
