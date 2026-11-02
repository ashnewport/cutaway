<script lang="ts">
	import FileUp from '@lucide/svelte/icons/file-up';
	import X from '@lucide/svelte/icons/x';
	import { FORMAT_NAMES, type SourceFormat } from '../core/index.ts';
	import { EXAMPLES } from '../examples/index.ts';
	import { app } from './app.svelte.ts';

	let fileInput = $state<HTMLInputElement>();

	const formats = Object.entries(FORMAT_NAMES) as [SourceFormat, string][];
	const warnings = $derived(app.compiled?.scene.diagram.warnings ?? []);

	async function openFile(event: Event): Promise<void> {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (file) app.loadText(await file.text());
	}
</script>

<aside class="source" aria-label="Diagram source">
	<header>
		<h2>Diagram source</h2>
		<button
			class="tool"
			type="button"
			aria-label="Close diagram source"
			onclick={() => (app.sourceOpen = false)}
		>
			<X size={18} />
		</button>
	</header>

	<div class="controls">
		<label class="field">
			Example
			<select
				value={app.exampleId ?? ''}
				onchange={(event) => app.loadExample(event.currentTarget.value)}
			>
				<option value="" disabled>Your diagram</option>
				{#each EXAMPLES as example (example.id)}
					<option value={example.id}>{example.name}</option>
				{/each}
			</select>
		</label>
		<label class="field">
			Format
			<select
				value={app.format}
				onchange={(event) => app.setFormat(event.currentTarget.value as SourceFormat | 'auto')}
			>
				<option value="auto">Detect from text</option>
				{#each formats as [id, name] (id)}
					<option value={id}>{name}</option>
				{/each}
			</select>
		</label>
	</div>

	<label class="sr-only" for="diagram-text">Diagram text</label>
	<textarea
		id="diagram-text"
		spellcheck="false"
		autocapitalize="off"
		autocomplete="off"
		wrap="off"
		aria-invalid={app.error ? 'true' : undefined}
		aria-describedby="source-status"
		value={app.source}
		oninput={(event) => app.editSource(event.currentTarget.value)}
	></textarea>

	<div id="source-status" class="status" role="status">
		{#if app.error}
			<p class="problem">
				{#if app.error.line}<strong>Line {app.error.line}.</strong>{/if}
				{app.error.message} The 3D view still shows the last version that worked.
			</p>
		{:else}
			{#each warnings as warning, index (index)}
				<p>
					{#if warning.line}<strong>Line {warning.line}.</strong>{/if}
					{warning.message}
				</p>
			{/each}
		{/if}
	</div>

	<div class="actions">
		<button class="tool" type="button" onclick={() => fileInput?.click()}>
			<FileUp size={16} /> Open file
		</button>
		<input
			bind:this={fileInput}
			class="sr-only"
			type="file"
			tabindex="-1"
			aria-hidden="true"
			accept=".mmd,.mermaid,.puml,.plantuml,.dot,.gv,.json,.txt,text/plain"
			onchange={openFile}
		/>
		<span class="drop-hint">or drop one anywhere</span>
	</div>

	<details>
		<summary>How to set layers and steps</summary>
		<dl>
			<dt>Layers</dt>
			<dd>
				Each top-level group becomes a plate: <code>subgraph</code>, <code>box</code>,
				<code>package</code>
				or <code>cluster</code>. Groups nested inside become regions on the plate.
			</dd>
			<dt>Steps</dt>
			<dd>
				Every arrow is a step, in the order written. Put <code>%% @step Your caption</code> above arrows
				to caption them or play them together.
			</dd>
			<dt>Regions in a sequence diagram</dt>
			<dd>
				<code>%% @zone vpc "VPC": alb, api</code>, and
				<code>%% @zone pub in vpc "Public": alb</code> to nest.
			</dd>
			<dt>Shapes</dt>
			<dd>
				Inferred from names like ALB, Redis or S3. Override with <code>%% @kind id database</code>.
			</dd>
		</dl>
	</details>
</aside>

<style>
	.source {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 20;
		display: flex;
		width: min(430px, 100vw);
		flex-direction: column;
		gap: 10px;
		padding: 10px 14px 14px;
		border-right: 1px solid var(--rule);
		background: var(--panel);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 16px;
		font-stretch: 112%;
		font-weight: 700;
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	select {
		width: 100%;
	}

	textarea {
		flex: 1;
		min-height: 120px;
		padding: 10px;
		border: 1px solid var(--rule);
		border-radius: var(--r);
		background: color-mix(in srgb, var(--panel), var(--ink) 4%);
		font-family: var(--font-code);
		font-size: 11.5px;
		line-height: 1.65;
		resize: none;
	}

	textarea[aria-invalid='true'] {
		border-color: var(--packet);
	}

	.status {
		max-height: 110px;
		overflow-y: auto;
		font-size: 13px;
	}

	.status p {
		margin: 0;
		color: var(--ink-soft);
	}

	.status .problem {
		color: var(--ink);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.actions .tool {
		border: 1px solid var(--rule);
	}

	.drop-hint {
		color: var(--ink-soft);
		font-size: 13px;
	}

	details {
		font-size: 13px;
	}

	summary {
		cursor: pointer;
		font-weight: 560;
	}

	dl {
		max-height: 34vh;
		margin: 8px 0 0;
		overflow-y: auto;
	}

	dt {
		margin-top: 8px;
		font-weight: 600;
	}

	dd {
		margin: 0;
		color: var(--ink-soft);
	}

	code {
		font-family: var(--font-code);
		font-size: 11px;
	}
</style>
