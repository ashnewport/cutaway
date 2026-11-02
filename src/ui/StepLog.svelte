<script lang="ts">
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import { app } from './app.svelte.ts';

	const script = $derived(app.compiled?.script);
	const scene = $derived(app.compiled?.scene);

	let list = $state<HTMLOListElement>();

	function band(layers: number[]): string {
		if (layers.length < 2) return app.colorOf(layers[0] ?? 0);
		const first = app.colorOf(layers[0]);
		const last = app.colorOf(layers[layers.length - 1]);
		return `linear-gradient(${first}, ${last})`;
	}

	// Keep the current step in view without moving anything but the list itself.
	$effect(() => {
		const index = app.step;
		const row = list?.children[index] as HTMLElement | undefined;
		if (!row || !list) return;
		const top = row.offsetTop - list.offsetTop;
		if (
			top < list.scrollTop + 40 ||
			top + row.offsetHeight > list.scrollTop + list.clientHeight - 40
		) {
			list.scrollTo({ top: top - list.clientHeight / 3 });
		}
	});
</script>

<aside class="log" aria-label="Layers and steps">
	{#if scene}
		<section class="legend" aria-label="Layers">
			<div class="legend-head">
				<h2>Layers</h2>
				<button class="link" type="button" onclick={() => app.panTo('all')}>See all</button>
			</div>
			<ul>
				{#each scene.layers as layer (layer.id)}
					{@const hidden = app.hidden.includes(layer.index)}
					<li class={{ hidden }}>
						<button
							class="pan"
							type="button"
							title="Pan to {layer.title}"
							onclick={() => app.panTo(layer.index)}
							disabled={hidden}
						>
							<span class="swatch" style:background={app.colorOf(layer.index)}></span>
							<span class="name">{layer.title}</span>
						</button>
						<button
							class="tool eye"
							type="button"
							aria-label="{hidden ? 'Show' : 'Hide'} {layer.title}"
							title="{hidden ? 'Show' : 'Hide'} this layer and its steps"
							onclick={() => app.toggleLayer(layer.index)}
						>
							{#if hidden}<EyeOff size={16} />{:else}<Eye size={16} />{/if}
						</button>
					</li>
				{/each}
			</ul>
			<p class="key">
				<span><i class="glyph data" style:background={app.theme.packet}></i>Data</span>
				<span
					><i class="glyph credential" style:background={app.theme.credential}></i>Credential</span
				>
				<span><i class="glyph failure" style:background={app.theme.error}></i>Failure</span>
			</p>
		</section>
	{/if}

	{#if script}
		<h2 class="steps-title">Steps</h2>
		{#if script.steps.length === 0}
			<p class="empty">
				This diagram has no links to play. Add an arrow between two nodes to create a step.
			</p>
		{/if}
		<ol bind:this={list}>
			{#each script.steps as step (step.id)}
				{@const current = step.index === app.step}
				{@const done = step.index < app.step}
				<li>
					<button
						type="button"
						class={['step', { current, done }]}
						aria-current={current ? 'step' : undefined}
						onclick={() => app.goToStep(step.index)}
					>
						<span class="band" style:background={band(step.layers)}></span>
						<span class="number">{step.index + 1}</span>
						<span class="body">
							<span class="title">{step.title}</span>
							{#if step.path !== step.title}<span class="path">{step.path}</span>{/if}
						</span>
					</button>
				</li>
			{/each}
		</ol>
	{/if}
</aside>

<style>
	.log {
		position: absolute;
		top: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		width: 318px;
		flex-direction: column;
		padding-top: 58px;
		border-left: 1px solid var(--rule);
		background: var(--panel);
	}

	h2 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
	}

	.legend {
		padding: 8px 14px 10px;
		border-bottom: 1px solid var(--rule);
	}

	.legend-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.link {
		padding: 2px 4px;
		border: 0;
		background: none;
		color: var(--ink-soft);
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	ul li {
		display: flex;
		align-items: center;
	}

	.pan {
		display: flex;
		min-width: 0;
		flex: 1;
		align-items: center;
		gap: 8px;
		height: 30px;
		padding: 0 4px 0 0;
		border: 0;
		background: none;
		text-align: left;
	}

	.pan:hover .name {
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.swatch {
		flex: none;
		width: 18px;
		height: 12px;
		border: 1px solid var(--rule);
		border-radius: calc(var(--r) * 0.6);
	}

	.name {
		overflow: hidden;
		font-weight: 560;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hidden .name,
	.hidden .swatch {
		opacity: 0.4;
	}

	.eye {
		height: 28px;
		min-width: 28px;
		padding: 0;
		color: var(--ink-soft);
	}

	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
		margin: 6px 0 0;
		color: var(--ink-soft);
		font-size: 12px;
	}

	.key span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}

	.glyph {
		display: inline-block;
		width: 10px;
		height: 10px;
	}

	.glyph.credential {
		transform: rotate(45deg) scale(0.85);
	}

	.glyph.failure {
		clip-path: polygon(50% 0, 100% 100%, 0 100%);
	}

	.steps-title {
		padding: 10px 14px 6px;
	}

	.empty {
		margin: 0;
		padding: 0 14px;
		color: var(--ink-soft);
	}

	ol {
		position: relative;
		flex: 1;
		margin: 0;
		padding: 0 0 14px;
		overflow-y: auto;
		list-style: none;
	}

	.step {
		display: grid;
		width: 100%;
		grid-template-columns: 12px 26px 1fr;
		gap: 0 6px;
		align-items: stretch;
		padding: 0 12px 0 14px;
		border: 0;
		background: none;
		text-align: left;
	}

	.step:hover {
		background: var(--rule);
	}

	.band {
		width: 8px;
		transition: width 0.14s;
	}

	.current .band {
		width: 12px;
	}

	.done .band {
		opacity: 0.45;
	}

	.number {
		padding: 7px 0;
		color: var(--ink-soft);
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		text-align: right;
	}

	.body {
		min-width: 0;
		padding: 6px 0 7px 4px;
	}

	.title {
		display: block;
		font-size: 13.5px;
		font-weight: 520;
		line-height: 1.3;
	}

	.current .title {
		font-weight: 720;
	}

	.current .number {
		color: var(--ink);
		font-weight: 700;
	}

	.path {
		display: block;
		color: var(--ink-soft);
		font-size: 12px;
		line-height: 1.3;
	}

	.done .title {
		color: var(--ink-soft);
	}

	@media (max-width: 900px) {
		.log {
			top: auto;
			bottom: var(--dock-height);
			width: 100%;
			height: 46vh;
			padding-top: 0;
			border-top: 1px solid var(--rule);
			border-left: 0;
			background: var(--panel);
		}
	}
</style>
