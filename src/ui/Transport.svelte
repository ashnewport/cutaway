<script lang="ts">
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Crosshair from '@lucide/svelte/icons/crosshair';
	import Expand from '@lucide/svelte/icons/expand';
	import Pause from '@lucide/svelte/icons/pause';
	import Play from '@lucide/svelte/icons/play';
	import Repeat from '@lucide/svelte/icons/repeat';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import SkipBack from '@lucide/svelte/icons/skip-back';
	import SkipForward from '@lucide/svelte/icons/skip-forward';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import ZoomIn from '@lucide/svelte/icons/zoom-in';
	import ZoomOut from '@lucide/svelte/icons/zoom-out';
	import { app } from './app.svelte.ts';

	const SPEEDS = [0.5, 1, 1.5, 2];

	const steps = $derived(app.compiled?.script.steps ?? []);
	const introEnd = $derived(app.compiled?.script.introDuration ?? 0);

	let wasPlaying = false;

	function clock(seconds: number): string {
		const whole = Math.max(0, Math.floor(seconds));
		return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
	}

	function band(layers: number[]): string {
		if (layers.length < 2) return app.colorOf(layers[0] ?? 0);
		return `linear-gradient(90deg, ${app.colorOf(layers[0])}, ${app.colorOf(layers[layers.length - 1])})`;
	}

	function beginScrub(): void {
		wasPlaying = app.playing;
		if (wasPlaying) app.stage?.director?.pause();
	}

	function endScrub(): void {
		if (wasPlaying) app.stage?.director?.play();
		wasPlaying = false;
	}

	function stepFromInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		const value = Number(input.value);
		if (Number.isFinite(value) && value >= 1) app.goToStep(value - 1);
	}
</script>

<div class="dock" role="group" aria-label="Playback controls">
	<div class="scrubber">
		<div class="bands" aria-hidden="true">
			<span style:flex-grow={introEnd} class="intro"></span>
			{#each steps as step (step.id)}
				<span
					style:flex-grow={step.end - step.start}
					style:background={band(step.layers)}
					class={{ past: step.index < app.step }}
				></span>
			{/each}
			<span style:flex-grow={Math.max(0.01, app.duration - (steps.at(-1)?.end ?? 0))} class="intro"
			></span>
		</div>
		<input
			type="range"
			aria-label="Timeline"
			aria-valuetext="{clock(app.time)} of {clock(app.duration)}"
			min="0"
			max={app.duration}
			step="0.01"
			value={app.time}
			onpointerdown={beginScrub}
			onpointerup={endScrub}
			oninput={(event) => app.scrub(Number(event.currentTarget.value))}
		/>
	</div>

	<div class="row">
		<div class="group">
			<button
				class="tool"
				type="button"
				aria-label="Restart"
				title="Restart"
				onclick={() => app.restart()}><RotateCcw size={18} /></button
			>
			<button
				class="tool"
				type="button"
				aria-label="Previous step"
				title="Previous step (left arrow)"
				onclick={() => app.previousStep()}><SkipBack size={18} /></button
			>
			<button
				class="tool play"
				type="button"
				aria-label={app.playing ? 'Pause' : 'Play'}
				title="{app.playing ? 'Pause' : 'Play'} (space)"
				onclick={() => app.togglePlay()}
			>
				{#if app.playing}<Pause size={20} />{:else}<Play size={20} />{/if}
			</button>
			<button
				class="tool"
				type="button"
				aria-label="Next step"
				title="Next step (right arrow)"
				onclick={() => app.nextStep()}><SkipForward size={18} /></button
			>
		</div>

		<div class="group readout">
			<span class="time">{clock(app.time)} / {clock(app.duration)}</span>
			<label class="goto">
				Step
				<input
					type="number"
					min="1"
					max={steps.length}
					value={app.step < 0 ? '' : app.step + 1}
					placeholder="–"
					onchange={stepFromInput}
				/>
				of {steps.length}
			</label>
		</div>

		<div class="group">
			<label class="sr-only" for="speed">Playback speed</label>
			<select
				id="speed"
				title="Playback speed"
				value={app.speed}
				onchange={(event) => app.setSpeed(Number(event.currentTarget.value))}
			>
				{#each SPEEDS as speed (speed)}
					<option value={speed}>{speed}x</option>
				{/each}
			</select>
			<button
				class="tool"
				type="button"
				aria-label="Loop"
				aria-pressed={app.loop}
				title="Loop"
				onclick={() => (app.loop = !app.loop)}><Repeat size={17} /></button
			>
		</div>

		<div class="group">
			<button
				class="tool"
				type="button"
				aria-label="Pan up a layer"
				title="Pan up a layer (up arrow)"
				onclick={() => app.panLayer(-1)}><ArrowUp size={18} /></button
			>
			<button
				class="tool"
				type="button"
				aria-label="Pan down a layer"
				title="Pan down a layer (down arrow)"
				onclick={() => app.panLayer(1)}><ArrowDown size={18} /></button
			>
			<button
				class="tool"
				type="button"
				aria-label="Zoom out"
				title="Zoom out (minus)"
				onclick={() => app.stage?.zoomBy(1.25)}><ZoomOut size={18} /></button
			>
			<button
				class="tool"
				type="button"
				aria-label="Zoom in"
				title="Zoom in (plus)"
				onclick={() => app.stage?.zoomBy(0.8)}><ZoomIn size={18} /></button
			>
			<button
				class="tool"
				type="button"
				aria-label="Reset camera"
				title="Reset camera (0)"
				onclick={() => app.stage?.resetCamera()}><Crosshair size={17} /></button
			>
		</div>

		<div class="group sound">
			<button
				class="tool"
				type="button"
				aria-label={app.muted ? 'Unmute' : 'Mute'}
				aria-pressed={app.muted}
				title="{app.muted ? 'Unmute' : 'Mute'} (M)"
				onclick={() => app.setMuted(!app.muted)}
			>
				{#if app.muted}<VolumeX size={18} />{:else}<Volume2 size={18} />{/if}
			</button>
			<input
				class="volume"
				type="range"
				aria-label="Volume"
				min="0"
				max="1"
				step="0.01"
				value={app.volume}
				oninput={(event) => app.setVolume(Number(event.currentTarget.value))}
			/>
			<button
				class="tool"
				type="button"
				aria-label="Full screen"
				title="Full screen (F)"
				onclick={() =>
					document.fullscreenElement
						? document.exitFullscreen()
						: document.documentElement.requestFullscreen()}><Expand size={17} /></button
			>
		</div>

		{#if !app.following}
			<button class="resume" type="button" onclick={() => app.resumeFollow()}
				>Follow the story</button
			>
		{/if}
	</div>
</div>

<style>
	.dock {
		padding: 0 12px 6px;
		border-top: 1px solid var(--rule);
		background: var(--panel-veil);
	}

	.scrubber {
		position: relative;
		height: 22px;
		margin: 0 -12px;
	}

	.bands {
		position: absolute;
		inset: 0 0 auto;
		display: flex;
		height: 8px;
		gap: 1px;
	}

	.bands span {
		min-width: 1px;
		flex-basis: 0;
	}

	.bands .past {
		opacity: 0.5;
	}

	.bands .intro {
		background: var(--rule);
	}

	.scrubber input {
		position: absolute;
		inset: -5px 0 0;
		width: 100%;
		height: 18px;
		margin: 0;
		background: none;
		appearance: none;
		cursor: pointer;
	}

	.scrubber input::-webkit-slider-runnable-track {
		height: 18px;
		background: none;
	}

	.scrubber input::-moz-range-track {
		background: none;
	}

	.scrubber input::-webkit-slider-thumb {
		width: 5px;
		height: 18px;
		border: 1px solid var(--panel);
		border-radius: 0;
		background: var(--ink);
		appearance: none;
	}

	.scrubber input::-moz-range-thumb {
		width: 5px;
		height: 18px;
		border: 1px solid var(--panel);
		border-radius: 0;
		background: var(--ink);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 16px;
	}

	.group {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.play {
		width: 44px;
		background: var(--ink);
		color: var(--panel);
	}

	.play:hover {
		background: var(--ink-soft);
	}

	.readout {
		gap: 12px;
		font-size: 13px;
		font-variant-numeric: tabular-nums;
	}

	.time {
		min-width: 74px;
	}

	.goto {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--ink-soft);
	}

	.goto input {
		width: 52px;
		height: 28px;
	}

	.group select {
		height: 30px;
	}

	.volume {
		width: 70px;
	}

	.resume {
		height: 30px;
		padding: 0 12px;
		border: 0;
		border-radius: var(--r);
		background: var(--packet);
		color: var(--on-packet);
		font-weight: 620;
	}

	@media (max-width: 640px) {
		.volume,
		.goto {
			display: none;
		}

		.row {
			gap: 2px 8px;
			justify-content: space-between;
		}
	}
</style>
