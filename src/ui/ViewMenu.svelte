<script lang="ts">
	import { app } from './app.svelte.ts';
	import Toggle from './Toggle.svelte';

	const SHORTCUTS = [
		['Space', 'Play or pause'],
		['Left, right', 'Previous or next step'],
		['Up, down', 'Pan between layers'],
		['Plus, minus', 'Zoom'],
		['0', 'Reset camera'],
		['M', 'Mute'],
		['I', 'Isometric view'],
		['F', 'Full screen'],
		['E', 'Diagram source'],
		['Drag', 'Orbit'],
		['Shift and drag', 'Pan']
	];
</script>

<div class="menu" role="group" aria-label="View options">
	<h2>Camera</h2>
	<Toggle
		label="Isometric view"
		hint="Parallel projection at the true isometric angle"
		checked={app.view.isometric}
		onchange={(isometric) => app.setView({ isometric })}
	/>
	<Toggle
		label="Follow the story"
		hint="Move the camera with each step"
		checked={app.following}
		onchange={(on) => app.stage?.setFollow(on)}
	/>
	<Toggle
		label="Gentle drift"
		checked={app.view.drift}
		onchange={(drift) => app.setView({ drift })}
	/>
	<label class="field gap">
		Space between layers
		<input
			type="range"
			min="0.5"
			max="2"
			step="0.05"
			value={app.gapScale}
			oninput={(event) => app.setGapScale(Number(event.currentTarget.value))}
		/>
	</label>

	<h2>Scene</h2>
	<Toggle
		label="Node labels"
		checked={app.view.labels}
		onchange={(labels) => app.setView({ labels })}
	/>
	<Toggle
		label="Message labels"
		hint="Shown on packets in flight"
		checked={app.view.packetLabels}
		onchange={(packetLabels) => app.setView({ packetLabels })}
	/>
	<Toggle label="Captions" checked={app.showCaptions} onchange={(on) => (app.showCaptions = on)} />
	<Toggle
		label="Idle routes"
		hint="Show links that have not been used yet"
		checked={app.view.idleRoutes}
		onchange={(idleRoutes) => app.setView({ idleRoutes })}
	/>
	<Toggle
		label="Fade other layers"
		checked={app.view.ghost}
		onchange={(ghost) => app.setView({ ghost })}
	/>
	<Toggle
		label="Shadows"
		checked={app.view.shadows}
		onchange={(shadows) => app.setView({ shadows })}
	/>
	<Toggle
		label="Glow"
		hint="Only in themes that use it"
		checked={app.view.bloom}
		onchange={(bloom) => app.setView({ bloom })}
	/>

	<h2>Sound</h2>
	<Toggle label="Ambient drone" checked={app.ambience} onchange={(on) => app.setAmbience(on)} />

	<h2>Shortcuts</h2>
	<dl>
		{#each SHORTCUTS as [key, action] (key)}
			<dt>{key}</dt>
			<dd>{action}</dd>
		{/each}
	</dl>
</div>

<style>
	.gap {
		margin-top: 8px;
	}

	.gap input {
		width: 100%;
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 2px 12px;
		margin: 0;
		font-size: 13px;
	}

	dt {
		font-weight: 600;
	}

	dd {
		margin: 0;
		color: var(--ink-soft);
	}
</style>
