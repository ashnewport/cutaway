<script lang="ts">
	import { FONT_STACKS, THEMES, type SoundPack, type Theme } from '../core/index.ts';
	import { app } from './app.svelte.ts';

	let themeText = $state('');
	let importError = $state('');

	const SOUND_NAMES: Record<SoundPack, string> = {
		marimba: 'Marimba',
		glass: 'Glass',
		chip: 'Chiptune'
	};

	const FINISH_NAMES: Record<Theme['finish'], string> = {
		satin: 'Satin',
		faceted: 'Faceted',
		wire: 'Line art'
	};

	const COLORS: {
		key: 'skyTop' | 'skyBottom' | 'ink' | 'inkSoft' | 'panel' | 'packet' | 'credential' | 'error';
		label: string;
	}[] = [
		{ key: 'skyTop', label: 'Sky, top' },
		{ key: 'skyBottom', label: 'Sky, bottom' },
		{ key: 'panel', label: 'Panels' },
		{ key: 'ink', label: 'Text' },
		{ key: 'inkSoft', label: 'Quiet text' },
		{ key: 'packet', label: 'Data packet' },
		{ key: 'credential', label: 'Credential' },
		{ key: 'error', label: 'Failure' }
	];

	function setLayerColor(index: number, color: string): void {
		const layerColors = [...app.theme.layerColors];
		layerColors[index] = color;
		app.patchTheme({ layerColors });
	}

	function exportTheme(): void {
		themeText = JSON.stringify(app.theme, null, 2);
		importError = '';
	}

	function importTheme(): void {
		try {
			const parsed = JSON.parse(themeText) as Partial<Theme>;
			if (!Array.isArray(parsed.layerColors) || !parsed.skyTop || !parsed.ink) {
				importError = 'A theme needs at least layerColors, skyTop and ink.';
				return;
			}
			app.setTheme({ ...app.theme, ...parsed });
			importError = '';
		} catch (error) {
			importError = `The JSON does not parse: ${(error as Error).message}`;
		}
	}
</script>

<div class="menu" role="group" aria-label="Theme options">
	<h2>Theme</h2>
	<div class="presets">
		{#each THEMES as theme (theme.id)}
			<button
				type="button"
				class="preset"
				aria-pressed={app.theme.id === theme.id}
				style:background="linear-gradient({theme.skyTop}, {theme.skyBottom})"
				style:color={theme.ink}
				style:border-radius="{theme.radius}px"
				onclick={() => app.setTheme(theme, { instant: true })}
			>
				<span class="plates" aria-hidden="true">
					{#each theme.layerColors.slice(0, 3) as color (color)}
						<i style:background={color}></i>
					{/each}
				</span>
				{theme.name}
			</button>
		{/each}
	</div>

	<h2>Layers</h2>
	<div class="swatches">
		{#each app.theme.layerColors as color, index (index)}
			<label>
				<span class="sr-only">Layer {index + 1} colour</span>
				<input
					type="color"
					value={color}
					oninput={(event) => setLayerColor(index, event.currentTarget.value)}
				/>
			</label>
		{/each}
	</div>

	<h2>Colours</h2>
	<div class="colors">
		{#each COLORS as { key, label } (key)}
			<label>
				<input
					type="color"
					value={app.theme[key]}
					oninput={(event) => app.patchTheme({ [key]: event.currentTarget.value })}
				/>
				{label}
			</label>
		{/each}
	</div>

	<h2>Materials</h2>
	<div class="stack">
		<label class="field">
			Plate opacity
			<input
				type="range"
				min="0.05"
				max="1"
				step="0.01"
				value={app.theme.plateOpacity}
				oninput={(event) => app.patchTheme({ plateOpacity: Number(event.currentTarget.value) })}
			/>
		</label>
		<label class="field">
			Glow
			<input
				type="range"
				min="0"
				max="1.5"
				step="0.05"
				value={app.theme.bloom}
				oninput={(event) => app.patchTheme({ bloom: Number(event.currentTarget.value) })}
			/>
		</label>
		<label class="field">
			Outlines
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={app.theme.outline}
				oninput={(event) => app.patchTheme({ outline: Number(event.currentTarget.value) })}
			/>
		</label>
		<label class="field">
			Corners
			<input
				type="range"
				min="0"
				max="12"
				step="1"
				value={app.theme.radius}
				oninput={(event) => app.patchTheme({ radius: Number(event.currentTarget.value) })}
			/>
		</label>
		<div class="pair">
			<label class="field">
				Finish
				<select
					value={app.theme.finish}
					onchange={(event) =>
						app.patchTheme({ finish: event.currentTarget.value as Theme['finish'] })}
				>
					{#each Object.entries(FINISH_NAMES) as [id, name] (id)}
						<option value={id}>{name}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				Display type
				<select
					value={app.theme.font}
					onchange={(event) => app.patchTheme({ font: event.currentTarget.value })}
				>
					{#each Object.entries(FONT_STACKS) as [id, stack] (id)}
						<option value={id}>{stack.name}</option>
					{/each}
				</select>
			</label>
		</div>
		<div class="pair">
			<label class="field">
				Sound
				<select
					value={app.theme.sound}
					onchange={(event) => {
						app.patchTheme({ sound: event.currentTarget.value as SoundPack });
						app.sound.preview();
					}}
				>
					{#each Object.entries(SOUND_NAMES) as [id, name] (id)}
						<option value={id}>{name}</option>
					{/each}
				</select>
			</label>
		</div>
	</div>

	<h2>Share a theme</h2>
	<textarea
		aria-label="Theme JSON"
		rows="4"
		spellcheck="false"
		placeholder="Paste theme JSON here"
		bind:value={themeText}
	></textarea>
	{#if importError}<p class="problem" role="alert">{importError}</p>{/if}
	<div class="pair">
		<button class="tool outlined" type="button" onclick={exportTheme}>Show current theme</button>
		<button class="tool outlined" type="button" disabled={!themeText.trim()} onclick={importTheme}
			>Apply JSON</button
		>
	</div>
</div>

<style>
	.presets {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.preset {
		display: grid;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--rule);
		font-size: 13px;
		font-weight: 600;
		text-align: left;
	}

	.preset[aria-pressed='true'] {
		outline: 2px solid var(--packet);
		outline-offset: 1px;
	}

	.plates {
		display: grid;
		gap: 2px;
	}

	.plates i {
		height: 5px;
	}

	.swatches {
		display: flex;
		gap: 6px;
	}

	input[type='color'] {
		width: 34px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--rule);
		border-radius: var(--r);
		background: none;
		cursor: pointer;
	}

	.colors {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 10px;
		font-size: 13px;
	}

	.colors label {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.stack {
		display: grid;
		gap: 8px;
	}

	.stack input[type='range'],
	select {
		width: 100%;
	}

	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	textarea {
		width: 100%;
		margin-bottom: 6px;
		padding: 6px;
		border: 1px solid var(--rule);
		border-radius: var(--r);
		background: none;
		font-family: var(--font-code);
		font-size: 11px;
	}

	.outlined {
		border: 1px solid var(--rule);
		font-size: 13px;
	}

	.problem {
		margin: 0 0 6px;
		font-size: 13px;
	}
</style>
