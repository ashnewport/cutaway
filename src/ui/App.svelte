<script lang="ts">
	import Clapperboard from '@lucide/svelte/icons/clapperboard';
	import Code from '@lucide/svelte/icons/code';
	import ListOrdered from '@lucide/svelte/icons/list-ordered';
	import Palette from '@lucide/svelte/icons/palette';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import { onMount } from 'svelte';
	import { app } from './app.svelte.ts';
	import ExportDialog from './ExportDialog.svelte';
	import SourcePanel from './SourcePanel.svelte';
	import StepLog from './StepLog.svelte';
	import ThemeMenu from './ThemeMenu.svelte';
	import Transport from './Transport.svelte';
	import ViewMenu from './ViewMenu.svelte';

	let canvas = $state<HTMLCanvasElement>();
	let stageWidth = $state(1);
	let stageHeight = $state(1);
	let bottomHeight = $state(90);
	let dragging = $state(false);

	const narrow = $derived(stageWidth <= 900);
	const title = $derived(app.compiled?.scene.diagram.title ?? 'Cutaway');
	const script = $derived(app.compiled?.script);
	const currentStep = $derived(script?.steps[app.step]);

	onMount(() => {
		// On a phone the step list would cover the whole scene, so it starts closed there.
		if (window.innerWidth <= 900) app.logOpen = false;

		// Text is drawn into WebGL textures, so wait for the fonts or the first frame uses fallbacks.
		let cancelled = false;
		void Promise.all([
			document.fonts.load('620 34px "Archivo Variable"'),
			document.fonts.load('700 96px "Archivo Variable"'),
			document.fonts.load('600 34px "Pixelify Sans"')
		])
			.catch(() => undefined)
			.then(() => {
				if (!cancelled && canvas) {
					app.attach(canvas);
					app.stage?.resize(stageWidth, stageHeight);
				}
			});
		return () => {
			cancelled = true;
			app.detach();
		};
	});

	$effect(() => {
		app.stage?.resize(stageWidth, stageHeight);
	});

	$effect(() => {
		app.stage?.setInsets({
			left: !narrow && app.sourceOpen ? Math.min(430, stageWidth) : 0,
			right: !narrow && app.logOpen ? 318 : 0,
			top: 56,
			// On a phone the step list is a sheet above the dock, covering 46% of the height.
			bottom: bottomHeight + (narrow && app.logOpen ? stageHeight * 0.46 : 0)
		});
	});

	function onKey(event: KeyboardEvent): void {
		const target = event.target as HTMLElement;
		if (
			target.closest('input, textarea, select, dialog') ||
			event.metaKey ||
			event.ctrlKey ||
			event.altKey
		) {
			if (event.key === 'Escape') target.blur?.();
			return;
		}
		const onButton = target.closest('button, a, summary');
		switch (event.key) {
			case ' ':
				if (onButton) return;
				app.togglePlay();
				break;
			case 'ArrowLeft':
				app.previousStep();
				break;
			case 'ArrowRight':
				app.nextStep();
				break;
			case 'ArrowUp':
				app.panLayer(-1);
				break;
			case 'ArrowDown':
				app.panLayer(1);
				break;
			case '+':
			case '=':
				app.stage?.zoomBy(0.8);
				break;
			case '-':
				app.stage?.zoomBy(1.25);
				break;
			case '0':
				app.stage?.resetCamera();
				break;
			case 'm':
				app.setMuted(!app.muted);
				break;
			case 'i':
				app.setView({ isometric: !app.view.isometric });
				break;
			case 'e':
				app.sourceOpen = !app.sourceOpen;
				break;
			case 'f':
				if (document.fullscreenElement) void document.exitFullscreen();
				else void document.documentElement.requestFullscreen();
				break;
			case 'Escape':
				app.menu = null;
				break;
			default:
				return;
		}
		event.preventDefault();
	}

	async function onDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		dragging = false;
		const file = event.dataTransfer?.files[0];
		if (file) app.loadText(await file.text());
	}
</script>

<svelte:window
	onkeydown={onKey}
	onpointerdown={() => app.sound.unlock()}
	ondragover={(event) => {
		event.preventDefault();
		dragging = true;
	}}
	ondragleave={(event) => {
		if (!event.relatedTarget) dragging = false;
	}}
	ondrop={onDrop}
/>

<svelte:head>
	<title>{title} in Cutaway</title>
</svelte:head>

<main
	class="app"
	style:--dock-height="{bottomHeight}px"
	bind:clientWidth={stageWidth}
	bind:clientHeight={stageHeight}
>
	<canvas
		bind:this={canvas}
		aria-label="3D view of {title}. The current step is described in the caption and in the step list."
	></canvas>

	{#if app.webglFailed}
		<div class="fallback">
			<!-- renderSvg escapes all diagram text, which tests/parse.test.ts verifies. -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html app.posterSvg}
			<p>This browser has WebGL turned off, so this is a static drawing of the same diagram.</p>
		</div>
	{/if}

	<header class="bar" style:left={!narrow && app.sourceOpen ? '430px' : '0'}>
		<div class="identity">
			<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
				<path fill={app.colorOf(0)} d="M16 3 30 10 16 17 2 10z" />
				<path fill={app.colorOf(1)} d="m2 15 14 7 14-7v3l-14 7-14-7z" />
				<path fill={app.colorOf(2)} d="m2 22 14 7 14-7v2l-14 7-14-7z" />
			</svg>
			<h1>{title}</h1>
		</div>
		<nav aria-label="Panels">
			<button
				class="tool"
				type="button"
				aria-label="Diagram"
				aria-pressed={app.sourceOpen}
				onclick={() => (app.sourceOpen = !app.sourceOpen)}
			>
				<Code size={17} /> <span class="word">Diagram</span>
			</button>
			<button
				class="tool"
				type="button"
				aria-label="Steps"
				aria-pressed={app.logOpen}
				onclick={() => (app.logOpen = !app.logOpen)}
			>
				<ListOrdered size={17} /> <span class="word">Steps</span>
			</button>
			<button
				class="tool"
				type="button"
				aria-label="View"
				aria-expanded={app.menu === 'view'}
				onclick={() => app.toggleMenu('view')}
			>
				<SlidersHorizontal size={17} /> <span class="word">View</span>
			</button>
			<button
				class="tool"
				type="button"
				aria-label="Theme"
				aria-expanded={app.menu === 'theme'}
				onclick={() => app.toggleMenu('theme')}
			>
				<Palette size={17} /> <span class="word">Theme</span>
			</button>
			<button
				class="tool exporter"
				type="button"
				aria-label="Export"
				onclick={() => (app.exportOpen = true)}
			>
				<Clapperboard size={17} /> <span class="word">Export</span>
			</button>
		</nav>
	</header>

	{#if app.menu === 'view'}<ViewMenu />{/if}
	{#if app.menu === 'theme'}<ThemeMenu />{/if}

	{#if app.logOpen}<StepLog />{/if}
	{#if app.sourceOpen}<SourcePanel />{/if}

	<div
		class="bottom"
		bind:clientHeight={bottomHeight}
		style:left={!narrow && app.sourceOpen ? '430px' : '0'}
		style:right={!narrow && app.logOpen ? '318px' : '0'}
	>
		{#if app.showCaptions && !(narrow && app.logOpen)}
			<div class="caption" aria-live="polite">
				{#if currentStep}
					<p class="step-title">{currentStep.title}</p>
					{#if currentStep.caption}<p class="step-caption">{currentStep.caption}</p>{/if}
					{#if !currentStep.caption && currentStep.path !== currentStep.title}<p
							class="step-caption"
						>
							{currentStep.path}
						</p>{/if}
				{:else if app.error && !app.compiled}
					<p class="step-title">This diagram has a problem</p>
					<p class="step-caption">{app.error.message} Open the diagram source to fix it.</p>
				{:else}
					<p class="step-title">{title}</p>
					<p class="step-caption">
						Each plate is a layer of the system. Press play to walk through them.
					</p>
				{/if}
			</div>
		{/if}
		<Transport />
	</div>

	{#if dragging}
		<div class="drop" aria-hidden="true">Drop a diagram file to load it</div>
	{/if}

	<ExportDialog />
</main>

<style>
	.app {
		position: relative;
		height: 100%;
		overflow: hidden;
	}

	canvas {
		position: absolute;
		inset: 0;
		display: block;
		width: 100%;
		height: 100%;
		touch-action: none;
		cursor: grab;
	}

	canvas:active {
		cursor: grabbing;
	}

	.bar {
		position: absolute;
		top: 0;
		right: 0;
		z-index: 25;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 54px;
		padding: 0 10px;
		pointer-events: none;
	}

	.bar > * {
		pointer-events: auto;
	}

	.identity {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 10px;
		padding: 6px 12px 6px 8px;
		border-radius: calc(var(--r) + 2px);
		background: var(--panel-veil);
	}

	.mark {
		flex: none;
		width: 26px;
		height: 26px;
	}

	h1 {
		margin: 0;
		overflow: hidden;
		font-family: var(--font-display);
		font-size: 19px;
		font-stretch: 118%;
		font-weight: 720;
		letter-spacing: -0.005em;
		line-height: 1.15;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	nav {
		display: flex;
		flex: none;
		gap: 2px;
		padding: 2px;
		border-radius: calc(var(--r) + 2px);
		background: var(--panel-veil);
	}

	.exporter {
		background: var(--packet);
		color: var(--on-packet);
		font-weight: 640;
	}

	.exporter:hover {
		background: var(--ink);
		color: var(--panel);
	}

	.bottom {
		position: absolute;
		bottom: 0;
		z-index: 15;
		pointer-events: none;
	}

	.bottom > :global(*) {
		pointer-events: auto;
	}

	.caption {
		max-width: 640px;
		margin: 0 0 12px 14px;
		padding: 10px 14px 11px;
		border-left: 6px solid var(--packet);
		background: var(--panel-veil);
		pointer-events: none;
	}

	.caption p {
		margin: 0;
	}

	.step-title {
		font-family: var(--font-display);
		font-size: 19px;
		font-stretch: 106%;
		font-weight: 680;
		line-height: 1.22;
	}

	.step-caption {
		margin-top: 2px;
		color: var(--ink-soft);
		font-size: 15px;
		line-height: 1.38;
	}

	.drop {
		position: absolute;
		inset: 10px;
		z-index: 40;
		display: grid;
		place-items: center;
		border: 3px dashed var(--packet);
		background: var(--panel-veil);
		font-family: var(--font-display);
		font-size: 26px;
		font-weight: 700;
		pointer-events: none;
	}

	.fallback {
		position: absolute;
		inset: 56px 0 120px;
		z-index: 5;
		overflow: auto;
		text-align: center;
	}

	.fallback :global(svg) {
		max-width: 100%;
		max-height: calc(100% - 40px);
	}

	@media (max-width: 900px) {
		.word {
			display: none;
		}

		h1 {
			font-size: 16px;
		}

		.caption {
			margin: 0 8px 8px;
		}

		.step-title {
			font-size: 16px;
		}

		.step-caption {
			font-size: 13.5px;
		}
	}
</style>
