import {
	compile,
	FONT_STACKS,
	layerColor,
	ParseError,
	renderSvg,
	themeById,
	THEMES,
	type Compiled,
	type SourceFormat,
	type Theme
} from '../core/index.ts';
import { EXAMPLES } from '../examples/index.ts';
import { SoundEngine } from '../stage/sound.ts';
import { DEFAULT_VIEW, Stage, type ViewOptions } from '../stage/stage.ts';
import { mix, readableOn } from '../stage/paint.ts';
import { readParam, writeExampleParam } from './url.ts';

const THEME_KEY = 'cutaway:theme';
const SOURCE_KEY = 'cutaway:source';

export interface SourceError {
	message: string;
	line: number | null;
}

function readJson<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function debounce(run: () => void, wait: number): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return () => {
		clearTimeout(timer);
		timer = setTimeout(run, wait);
	};
}

/** All UI state, and the only place the UI talks to the stage. */
export class AppStore {
	source = $state('');
	format = $state<SourceFormat | 'auto'>('auto');
	exampleId = $state<string | null>(EXAMPLES[0].id);
	compiled = $state.raw<Compiled | null>(null);
	error = $state<SourceError | null>(null);

	theme = $state.raw<Theme>(THEMES[0]);
	view = $state<ViewOptions>({ ...DEFAULT_VIEW });
	showCaptions = $state(true);
	gapScale = $state(1);
	hidden = $state<number[]>([]);

	time = $state(0);
	duration = $state(1);
	step = $state(-1);
	playing = $state(false);
	following = $state(true);
	speed = $state(1);
	loop = $state(false);

	muted = $state(false);
	volume = $state(0.8);
	ambience = $state(true);

	sourceOpen = $state(false);
	logOpen = $state(true);
	menu = $state<'view' | 'theme' | null>(null);
	exportOpen = $state(false);
	webglFailed = $state(false);
	posterSvg = $state('');

	readonly sound = new SoundEngine();
	stage: Stage | null = null;
	private readonly recompileSoon = debounce(() => this.recompile(false), 320);
	private readonly reloadSoon = debounce(() => this.reload(), 120);
	private readonly reducedMotion =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	constructor() {
		const saved = readJson<Theme>(THEME_KEY);
		const prefersDark =
			typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
		const requested = readParam('theme');
		this.theme = requested
			? themeById(requested)
			: (saved ?? themeById(prefersDark ? 'shaft' : 'survey'));
		this.sound.pack = this.theme.sound;
		this.applyThemeVariables();

		const example = EXAMPLES.find((candidate) => candidate.id === readParam('example'));
		const draft = localStorage.getItem(SOURCE_KEY);
		if (example) {
			this.source = example.source;
			this.exampleId = example.id;
		} else if (draft) {
			this.source = draft;
			this.exampleId = null;
		} else {
			this.source = EXAMPLES[0].source;
		}
	}

	attach(canvas: HTMLCanvasElement): void {
		try {
			const stage = new Stage(canvas);
			stage.callbacks = {
				onFrame: (info) => {
					this.time = info.time;
					this.duration = info.duration;
					this.step = info.step;
					if (info.playing !== this.playing) {
						this.playing = info.playing;
						this.sound.setPlaying(info.playing);
					}
				},
				onCue: (cue) => this.sound.fire(cue),
				onEnd: () => {
					// A finished GSAP timeline is not paused, so scrubbing back would quietly resume it.
					if (this.loop) this.stage?.director?.play();
					else this.stage?.director?.pause();
				},
				onFollowChange: (following) => {
					this.following = following;
				}
			};
			this.stage = stage;
		} catch (error) {
			console.warn('WebGL is unavailable, showing the static drawing instead', error);
			this.webglFailed = true;
		}
		this.recompile(true);
	}

	detach(): void {
		this.stage?.dispose();
		this.stage = null;
		this.sound.dispose();
	}

	private loadIntoStage(compiled: Compiled, restart: boolean): void {
		const stage = this.stage;
		if (!stage) {
			this.posterSvg = renderSvg(compiled.scene, this.theme);
			return;
		}
		const previous = stage.director;
		const stepId = previous?.script.steps[previous.stepAt(previous.time)]?.id;
		const wasPlaying = previous?.playing ?? false;

		stage.load(compiled.scene, compiled.script, this.theme, $state.snapshot(this.hidden));
		const director = stage.director!;
		director.timeline.timeScale(this.speed);

		if (restart) {
			director.seek(0);
			if (this.reducedMotion) {
				director.seek(compiled.script.introDuration);
			} else {
				director.play();
			}
		} else {
			const index = compiled.script.steps.findIndex((step) => step.id === stepId);
			if (index >= 0) director.seek(compiled.script.steps[index].start);
			else director.seek(compiled.script.introDuration);
			if (wasPlaying) director.play();
		}
		stage.markDirty();
	}

	recompile(restart: boolean): void {
		try {
			const compiled = compile(this.source, {
				format: this.format === 'auto' ? undefined : this.format,
				gapScale: this.gapScale,
				hiddenLayers: $state.snapshot(this.hidden)
			});
			this.compiled = compiled;
			this.error = null;
			this.loadIntoStage(compiled, restart);
		} catch (error) {
			if (error instanceof ParseError) {
				this.error = { message: error.message, line: error.line };
			} else {
				console.error(error);
				this.error = { message: (error as Error).message, line: null };
			}
		}
	}

	private reload(): void {
		if (this.compiled) this.loadIntoStage(this.compiled, false);
	}

	editSource(text: string): void {
		this.source = text;
		this.exampleId = null;
		writeExampleParam(null);
		localStorage.setItem(SOURCE_KEY, text);
		this.hidden = [];
		this.recompileSoon();
	}

	setFormat(format: SourceFormat | 'auto'): void {
		this.format = format;
		this.recompile(false);
	}

	loadExample(id: string): void {
		const example = EXAMPLES.find((candidate) => candidate.id === id);
		if (!example) return;
		this.source = example.source;
		this.exampleId = id;
		writeExampleParam(id);
		this.format = 'auto';
		this.hidden = [];
		localStorage.removeItem(SOURCE_KEY);
		this.stage?.setFollow(true);
		this.recompile(true);
	}

	loadText(text: string): void {
		this.source = text;
		this.exampleId = null;
		writeExampleParam(null);
		this.format = 'auto';
		this.hidden = [];
		localStorage.setItem(SOURCE_KEY, text);
		this.sourceOpen = true;
		this.recompile(true);
	}

	setGapScale(scale: number): void {
		this.gapScale = scale;
		this.recompileSoon();
	}

	toggleLayer(index: number): void {
		const layers = this.compiled?.scene.layers.length ?? 0;
		if (this.hidden.includes(index)) {
			this.hidden = this.hidden.filter((value) => value !== index);
		} else if (this.hidden.length < layers - 1) {
			this.hidden = [...this.hidden, index];
		} else {
			return;
		}
		this.recompile(false);
	}

	private applyThemeVariables(): void {
		const theme = this.theme;
		const stack = FONT_STACKS[theme.font] ?? FONT_STACKS.archivo;
		const root = document.documentElement.style;
		root.setProperty('--sky-top', theme.skyTop);
		root.setProperty('--sky-bottom', theme.skyBottom);
		root.setProperty('--ink', theme.ink);
		root.setProperty('--ink-soft', theme.inkSoft);
		root.setProperty('--panel', theme.panel);
		root.setProperty('--panel-veil', `${theme.panel}ee`);
		root.setProperty('--rule', `${mix(theme.ink, theme.panel, 0.25)}55`);
		root.setProperty('--packet', theme.packet);
		root.setProperty('--on-packet', readableOn(theme.packet, '#101018', '#ffffff'));
		root.setProperty('--r', `${theme.radius}px`);
		root.setProperty('--font-display', stack.display);
		root.setProperty('--font-body', stack.body);
		document.documentElement.style.colorScheme = theme.mode;
	}

	setTheme(theme: Theme, options: { instant?: boolean } = {}): void {
		this.theme = theme;
		this.applyThemeVariables();
		this.sound.pack = theme.sound;
		localStorage.setItem(THEME_KEY, JSON.stringify(theme));
		// The stage draws text into textures, so the theme's font must be ready first.
		void document.fonts.ready.then(() => {
			if (options.instant) this.reload();
			else this.reloadSoon();
		});
	}

	patchTheme(patch: Partial<Theme>): void {
		this.setTheme({ ...this.theme, ...patch, id: 'custom', name: 'Custom' });
	}

	colorOf(layerIndex: number): string {
		return layerColor(this.theme, layerIndex);
	}

	setView(patch: Partial<ViewOptions>): void {
		Object.assign(this.view, patch);
		this.stage?.setView($state.snapshot(this.view));
	}

	togglePlay(): void {
		const director = this.stage?.director;
		if (!director) return;
		this.sound.unlock();
		if (director.playing) {
			director.pause();
		} else {
			this.stage?.setFollow(true);
			director.play();
		}
		this.stage?.markDirty();
	}

	restart(): void {
		const director = this.stage?.director;
		if (!director) return;
		this.sound.unlock();
		this.stage?.setFollow(true);
		director.seek(0);
		director.play();
	}

	goToStep(index: number): void {
		const director = this.stage?.director;
		if (!director) return;
		const steps = director.script.steps;
		const target = Math.max(0, Math.min(steps.length - 1, index));
		this.sound.unlock();
		this.stage?.setFollow(true);
		if (director.playing) director.seekStep(target);
		else director.playStep(target);
		this.stage?.markDirty();
	}

	nextStep(): void {
		this.goToStep(this.step + 1);
	}

	previousStep(): void {
		this.goToStep(this.step - 1);
	}

	scrub(time: number): void {
		this.stage?.director?.seek(time);
		this.stage?.markDirty();
	}

	setSpeed(speed: number): void {
		this.speed = speed;
		this.stage?.director?.timeline.timeScale(speed);
	}

	panLayer(direction: -1 | 1): void {
		const stage = this.stage;
		if (!stage) return;
		const count = this.compiled?.scene.layers.length ?? 1;
		const next = Math.max(0, Math.min(count - 1, stage.currentLayer() + direction));
		stage.panToLayer(next);
	}

	panTo(index: number | 'all'): void {
		this.stage?.panToLayer(index);
	}

	resumeFollow(): void {
		this.stage?.setFollow(true);
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.sound.unlock();
		this.sound.setMuted(muted);
	}

	setVolume(volume: number): void {
		this.volume = volume;
		this.sound.setVolume(volume);
		if (volume > 0 && this.muted) this.setMuted(false);
	}

	setAmbience(on: boolean): void {
		this.ambience = on;
		this.sound.setAmbience(on);
	}

	toggleMenu(menu: 'view' | 'theme'): void {
		this.menu = this.menu === menu ? null : menu;
	}
}

export const app = new AppStore();
