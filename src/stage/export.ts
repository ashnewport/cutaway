import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
	AudioBufferSource,
	BufferTarget,
	CanvasSource,
	getFirstEncodableAudioCodec,
	getFirstEncodableVideoCodec,
	Mp4OutputFormat,
	Output,
	QUALITY_HIGH,
	WebMOutputFormat
} from 'mediabunny';
import { FONT_STACKS, type Script, type SoundPack, type Theme } from '../core/index.ts';
import { renderSoundtrack } from './sound.ts';
import type { Stage } from './stage.ts';

export interface ExportOptions {
	format: 'mp4' | 'webm' | 'gif';
	width: number;
	height: number;
	fps: number;
	audio: boolean;
	captions: boolean;
	fromStep: number;
	toStep: number;
	theme: Theme;
	title: string;
	pack: SoundPack;
	ambience: boolean;
	volume: number;
}

export interface ExportResult {
	blob: Blob;
	filename: string;
	frames: number;
	seconds: number;
	codec: string;
}

export type Progress = (fraction: number, label: string) => void;

export class ExportCancelled extends Error {}

function timeRange(
	script: Script,
	options: ExportOptions
): { from: number; to: number; whole: boolean } {
	const last = script.steps.length - 1;
	if (last < 0) return { from: 0, to: script.duration, whole: true };
	const fromStep = Math.max(0, Math.min(options.fromStep, last));
	const toStep = Math.max(fromStep, Math.min(options.toStep, last));
	const whole = fromStep === 0 && toStep === last;
	return {
		from: whole ? 0 : script.steps[fromStep].start,
		to: whole ? script.duration : script.steps[toStep].end,
		whole
	};
}

function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of text.split(/\s+/)) {
		const attempt = current ? `${current} ${word}` : word;
		if (context.measureText(attempt).width > maxWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = attempt;
		}
	}
	if (current) lines.push(current);
	return lines;
}

/** Burns the step caption into a frame, because HTML overlays do not reach the encoder. */
function drawCaption(
	context: CanvasRenderingContext2D,
	script: Script,
	stepIndex: number,
	options: ExportOptions,
	total: number
): void {
	const { width, height, theme } = options;
	const step = script.steps[stepIndex];
	const stack = FONT_STACKS[theme.font] ?? FONT_STACKS.archivo;
	const unit = Math.min(width, height * 1.5) / 1280;
	const margin = 32 * unit;
	const maxWidth = Math.min(width - margin * 2, 760 * unit);
	const titleSize = 26 * unit;
	const bodySize = 21 * unit;

	const title = step ? step.title : options.title;
	const body = step ? step.caption : '';
	context.font = `650 ${titleSize}px ${stack.display}`;
	const titleLines = wrapLines(context, title, maxWidth - 40 * unit).slice(0, 2);
	context.font = `400 ${bodySize}px ${stack.body}`;
	const bodyLines = body ? wrapLines(context, body, maxWidth - 40 * unit).slice(0, 3) : [];

	const boxHeight =
		titleLines.length * titleSize * 1.25 + bodyLines.length * bodySize * 1.35 + 34 * unit;
	const boxY = height - boxHeight - margin;
	context.fillStyle = `${theme.panel}eb`;
	context.beginPath();
	context.roundRect(margin, boxY, maxWidth, boxHeight, theme.radius * unit * 2);
	context.fill();

	context.textBaseline = 'top';
	context.fillStyle = theme.ink;
	let y = boxY + 16 * unit;
	context.font = `650 ${titleSize}px ${stack.display}`;
	for (const line of titleLines) {
		context.fillText(line, margin + 20 * unit, y);
		y += titleSize * 1.25;
	}
	context.font = `400 ${bodySize}px ${stack.body}`;
	context.fillStyle = theme.inkSoft;
	for (const line of bodyLines) {
		context.fillText(line, margin + 20 * unit, y);
		y += bodySize * 1.35;
	}

	if (step) {
		const count = `${stepIndex + 1} of ${total}`;
		context.font = `600 ${18 * unit}px ${stack.body}`;
		const measure = context.measureText(count).width;
		context.fillStyle = `${theme.panel}eb`;
		context.beginPath();
		context.roundRect(
			width - margin - measure - 24 * unit,
			margin,
			measure + 24 * unit,
			36 * unit,
			theme.radius * unit * 2
		);
		context.fill();
		context.fillStyle = theme.ink;
		context.fillText(count, width - margin - measure - 12 * unit, margin + 8 * unit);
	}
}

function slugify(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'cutaway'
	);
}

export interface VideoSupport {
	mp4: string | null;
	webm: string | null;
	webcodecs: boolean;
}

/** Asks this browser which codecs it can really encode at the requested size. */
export async function probeVideoSupport(width = 1280, height = 720): Promise<VideoSupport> {
	if (typeof VideoEncoder === 'undefined') return { mp4: null, webm: null, webcodecs: false };
	const [mp4, webm] = await Promise.all([
		getFirstEncodableVideoCodec(['avc', 'hevc', 'av1', 'vp9'], { width, height }),
		getFirstEncodableVideoCodec(['vp9', 'vp8', 'av1'], { width, height })
	]);
	return { mp4, webm, webcodecs: true };
}

async function nextTask(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Frame-accurate and faster than real time on a real GPU, since it seeks instead of waiting. */
export async function exportVideo(
	stage: Stage,
	options: ExportOptions,
	progress: Progress,
	signal: AbortSignal
): Promise<ExportResult> {
	const director = stage.director;
	if (!director) throw new Error('Load a diagram before exporting');
	const { script } = director;
	const { from, to } = timeRange(script, options);
	const seconds = to - from;
	const total = script.steps.length;
	const dimensions = { width: options.width, height: options.height };

	const format = options.format === 'mp4' ? new Mp4OutputFormat() : new WebMOutputFormat();
	const videoCodec = await getFirstEncodableVideoCodec(
		format.getSupportedVideoCodecs(),
		dimensions
	);
	if (!videoCodec)
		throw new Error(
			`This browser cannot encode ${options.format.toUpperCase()} video. Try a different format.`
		);

	const composite = document.createElement('canvas');
	composite.width = options.width;
	composite.height = options.height;
	const context = composite.getContext('2d', { alpha: false })!;

	const target = new BufferTarget();
	const output = new Output({ format, target });
	const video = new CanvasSource(composite, { codec: videoCodec, bitrate: QUALITY_HIGH });
	output.addVideoTrack(video, { frameRate: options.fps });

	let audioSource: AudioBufferSource | null = null;
	let audioCodec: string | null = null;
	if (options.audio) {
		audioCodec = await getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
			numberOfChannels: 2,
			sampleRate: 48000
		});
		if (audioCodec) {
			audioSource = new AudioBufferSource({ codec: audioCodec as never, bitrate: QUALITY_HIGH });
			output.addAudioTrack(audioSource);
		}
	}

	await output.start();
	const frameCount = Math.ceil(seconds * options.fps);
	const restore = stage.beginCapture(options.width, options.height);
	const resumeAt = director.time;
	const wasPlaying = director.playing;
	director.pause();
	try {
		for (let frame = 0; frame < frameCount; frame++) {
			if (signal.aborted) throw new ExportCancelled('Export cancelled');
			const time = from + frame / options.fps;
			stage.captureFrame(time);
			context.drawImage(stage.renderer.domElement, 0, 0, options.width, options.height);
			if (options.captions) drawCaption(context, script, director.stepAt(time), options, total);
			await video.add(frame / options.fps, 1 / options.fps);
			progress(((frame + 1) / frameCount) * 0.92, `Rendering frame ${frame + 1} of ${frameCount}`);
			if (frame % 4 === 0) await nextTask();
		}
		video.close();
		if (audioSource) {
			progress(0.94, 'Rendering sound');
			const soundtrack = await renderSoundtrack(script, from, to, {
				pack: options.pack,
				ambience: options.ambience,
				volume: options.volume
			});
			await audioSource.add(soundtrack);
			audioSource.close();
		}
		progress(0.98, 'Finishing file');
		await output.finalize();
	} catch (error) {
		await output.cancel().catch(() => undefined);
		throw error;
	} finally {
		restore();
		director.seek(resumeAt);
		if (wasPlaying) director.play();
	}

	const buffer = target.buffer;
	if (!buffer) throw new Error('The encoder produced no data');
	return {
		blob: new Blob([buffer], { type: options.format === 'mp4' ? 'video/mp4' : 'video/webm' }),
		filename: `${slugify(options.title)}.${options.format}`,
		frames: frameCount,
		seconds,
		codec: [videoCodec, audioCodec].filter(Boolean).join(' + ')
	};
}

/** Builds one palette from frames across the whole clip, so colours do not flicker between frames. */
export async function exportGif(
	stage: Stage,
	options: ExportOptions,
	progress: Progress,
	signal: AbortSignal
): Promise<ExportResult> {
	const director = stage.director;
	if (!director) throw new Error('Load a diagram before exporting');
	const { script } = director;
	const { from, to } = timeRange(script, options);
	const seconds = to - from;
	const total = script.steps.length;
	const { width, height, fps } = options;

	const composite = document.createElement('canvas');
	composite.width = width;
	composite.height = height;
	const context = composite.getContext('2d', { willReadFrequently: true, alpha: false })!;
	const frameCount = Math.ceil(seconds * fps);
	const restore = stage.beginCapture(width, height);
	const resumeAt = director.time;
	const wasPlaying = director.playing;
	director.pause();

	const grab = (time: number): Uint8ClampedArray => {
		stage.captureFrame(time);
		context.drawImage(stage.renderer.domElement, 0, 0, width, height);
		if (options.captions) drawCaption(context, script, director.stepAt(time), options, total);
		return context.getImageData(0, 0, width, height).data;
	};

	try {
		progress(0, 'Choosing colours');
		const samples = 10;
		const stride = 3;
		const sampled = new Uint8ClampedArray(samples * Math.ceil((width * height) / stride) * 4 + 16);
		let cursor = 0;
		for (let index = 0; index < samples; index++) {
			const data = grab(from + (seconds * (index + 0.5)) / samples);
			for (let pixel = 0; pixel < data.length; pixel += stride * 4) {
				sampled[cursor++] = data[pixel];
				sampled[cursor++] = data[pixel + 1];
				sampled[cursor++] = data[pixel + 2];
				sampled[cursor++] = 255;
			}
		}
		const palette = quantize(sampled.subarray(0, cursor), 256, { format: 'rgb565' });
		const encoder = GIFEncoder();
		const delay = Math.round(1000 / fps);
		for (let frame = 0; frame < frameCount; frame++) {
			if (signal.aborted) throw new ExportCancelled('Export cancelled');
			const data = grab(from + frame / fps);
			const index = applyPalette(data, palette, 'rgb565');
			encoder.writeFrame(
				index,
				width,
				height,
				frame === 0 ? { palette, delay, repeat: 0 } : { delay }
			);
			progress((frame + 1) / frameCount, `Encoding frame ${frame + 1} of ${frameCount}`);
			await nextTask();
		}
		encoder.finish();
		return {
			blob: new Blob([encoder.bytes()], { type: 'image/gif' }),
			filename: `${slugify(options.title)}.gif`,
			frames: frameCount,
			seconds,
			codec: 'GIF'
		};
	} finally {
		restore();
		director.seek(resumeAt);
		if (wasPlaying) director.play();
	}
}

export function exportPng(stage: Stage, options: ExportOptions, time: number): Promise<Blob> {
	const director = stage.director;
	if (!director) throw new Error('Load a diagram before exporting');
	const composite = document.createElement('canvas');
	composite.width = options.width;
	composite.height = options.height;
	const context = composite.getContext('2d', { alpha: false })!;
	const restore = stage.beginCapture(options.width, options.height);
	try {
		stage.captureFrame(time);
		context.drawImage(stage.renderer.domElement, 0, 0, options.width, options.height);
		if (options.captions)
			drawCaption(
				context,
				director.script,
				director.stepAt(time),
				options,
				director.script.steps.length
			);
	} finally {
		restore();
		director.seek(time);
	}
	return new Promise((resolve, reject) => {
		composite.toBlob(
			(blob) => (blob ? resolve(blob) : reject(new Error('The browser could not create the PNG'))),
			'image/png'
		);
	});
}
