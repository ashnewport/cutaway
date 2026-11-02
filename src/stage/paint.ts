import * as THREE from 'three';
import { FONT_STACKS, type Theme } from '../core/index.ts';

export function mix(a: string, b: string, t: number): string {
	return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Picks whichever of two inks reads best on a background, using WCAG relative luminance. */
export function readableOn(background: string, dark: string, light: string): string {
	const luminance = (hex: string): number => {
		const color = new THREE.Color(hex);
		return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
	};
	const contrast = (x: number, y: number): number =>
		(Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
	const base = luminance(background);
	return contrast(base, luminance(dark)) >= contrast(base, luminance(light)) ? dark : light;
}

export function canvasTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = 8;
	return texture;
}

function wrap(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxLines: number
): string[] {
	const lines: string[] = [];
	let current = '';
	for (const word of text.split(/\s+/)) {
		const attempt = current ? `${current} ${word}` : word;
		if (context.measureText(attempt).width > maxWidth && current) {
			lines.push(current);
			current = word;
			if (lines.length === maxLines - 1) break;
		} else {
			current = attempt;
		}
	}
	const used = lines.join(' ').split(/\s+/).filter(Boolean).length;
	const rest = text.split(/\s+/).slice(used).join(' ');
	let last = rest || current;
	if (context.measureText(last).width > maxWidth) {
		while (last.length > 1 && context.measureText(`${last}…`).width > maxWidth)
			last = last.slice(0, -1);
		last = `${last.trimEnd()}…`;
	}
	lines.push(last);
	return lines;
}

function roundRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number
): void {
	context.beginPath();
	context.roundRect(x, y, w, h, Math.min(r, h / 2));
}

export interface LabelOptions {
	text: string;
	sub?: string;
	ink: string;
	background: string;
	radius: number;
	font: string;
	weight?: number;
}

/** A billboard label drawn into the WebGL scene, so it also appears in exported video. */
export function makeLabel(options: LabelOptions): THREE.Sprite {
	const stack = FONT_STACKS[options.font] ?? FONT_STACKS.archivo;
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d')!;
	const size = 34;
	const subSize = 24;
	const padX = 20;
	const padY = 12;
	const lineGap = 6;
	const titleFont = `${options.weight ?? 620} ${size}px ${stack.display}`;
	const subFont = `400 ${subSize}px ${stack.body}`;

	context.font = titleFont;
	const lines = wrap(context, options.text, 370, 2);
	let width = Math.max(...lines.map((line) => context.measureText(line).width));
	context.font = subFont;
	const sub = options.sub ? wrap(context, options.sub, 370, 1)[0] : '';
	if (sub) width = Math.max(width, context.measureText(sub).width);

	const height =
		lines.length * (size + lineGap) + (sub ? subSize + lineGap : 0) + padY * 2 - lineGap;
	canvas.width = Math.ceil(width + padX * 2);
	canvas.height = Math.ceil(height);

	context.fillStyle = options.background;
	roundRect(context, 0, 0, canvas.width, canvas.height, options.radius * 3);
	context.fill();
	context.textBaseline = 'top';
	context.textAlign = 'center';
	context.fillStyle = options.ink;
	context.font = titleFont;
	lines.forEach((line, index) => {
		context.fillText(line, canvas.width / 2, padY + index * (size + lineGap));
	});
	if (sub) {
		context.font = subFont;
		context.globalAlpha = 0.72;
		context.fillText(sub, canvas.width / 2, padY + lines.length * (size + lineGap));
		context.globalAlpha = 1;
	}

	const material = new THREE.SpriteMaterial({
		map: canvasTexture(canvas),
		transparent: true,
		depthWrite: false,
		toneMapped: false,
		fog: false
	});
	const sprite = new THREE.Sprite(material);
	const worldPerPixel = 0.0112;
	sprite.scale.set(canvas.width * worldPerPixel, canvas.height * worldPerPixel, 1);
	sprite.center.set(0.5, 0);
	sprite.renderOrder = 10;
	return sprite;
}

/** Text lying flat on a surface, as if printed on it. Width is in world units. */
export function makePrintedText(
	text: string,
	theme: Theme,
	options: {
		size: number;
		weight: number;
		stretch?: CanvasFontStretch;
		color: string;
		opacity?: number;
	}
): THREE.Mesh {
	const stack = FONT_STACKS[theme.font] ?? FONT_STACKS.archivo;
	const canvas = document.createElement('canvas');
	const context = canvas.getContext('2d')!;
	const px = 96;
	const font = `${options.weight} ${px}px ${stack.display}`;
	context.font = font;
	if (options.stretch) context.fontStretch = options.stretch;
	const width = Math.ceil(context.measureText(text).width) + 16;
	canvas.width = Math.min(width, 4096);
	canvas.height = Math.ceil(px * 1.3);
	context.font = font;
	if (options.stretch) context.fontStretch = options.stretch;
	context.textBaseline = 'middle';
	context.fillStyle = options.color;
	context.fillText(text, 8, canvas.height / 2);

	const worldHeight = options.size * 1.3;
	const worldWidth = worldHeight * (canvas.width / canvas.height);
	const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight);
	geometry.rotateX(-Math.PI / 2);
	geometry.translate(worldWidth / 2, 0, 0);
	const material = new THREE.MeshBasicMaterial({
		map: canvasTexture(canvas),
		transparent: true,
		depthWrite: false,
		opacity: options.opacity ?? 1,
		toneMapped: false
	});
	return new THREE.Mesh(geometry, material);
}

function field(x: number, y: number, seed: number): number {
	return (
		Math.sin(x * 2.1 + seed * 1.7) * Math.cos(y * 1.6 - seed) +
		0.6 * Math.sin(x * 4.3 - y * 2.7 + seed * 2.3) +
		0.35 * Math.cos(x * 7.1 + y * 6.3 + seed * 0.7)
	);
}

/**
 * The texture printed on a plate. Survey theme gets contour lines, like a geological map.
 * Line art gets drafting paper, and the arcade gets a dot matrix.
 */
export function makePlateTexture(
	theme: Theme,
	seed: number,
	aspect: number,
	ink: string
): THREE.CanvasTexture {
	const height = 512;
	const width = Math.round(height * aspect);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext('2d')!;

	if (theme.finish === 'wire') {
		context.strokeStyle = ink;
		const cell = 32;
		for (let x = 0; x <= width; x += cell) {
			context.globalAlpha = x % (cell * 4) === 0 ? 0.5 : 0.18;
			context.beginPath();
			context.moveTo(x, 0);
			context.lineTo(x, height);
			context.stroke();
		}
		for (let y = 0; y <= height; y += cell) {
			context.globalAlpha = y % (cell * 4) === 0 ? 0.5 : 0.18;
			context.beginPath();
			context.moveTo(0, y);
			context.lineTo(width, y);
			context.stroke();
		}
	} else if (theme.finish === 'faceted') {
		context.fillStyle = ink;
		context.globalAlpha = 0.28;
		const cell = 24;
		for (let x = cell / 2; x < width; x += cell) {
			for (let y = cell / 2; y < height; y += cell) context.fillRect(x - 2, y - 2, 4, 4);
		}
	} else {
		const image = context.createImageData(width, height);
		const color = new THREE.Color(ink).convertLinearToSRGB();
		const bands = 7;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const value = field((x / height) * 1.4, (y / height) * 1.4, seed) * bands;
				const distance = Math.abs(value - Math.round(value));
				const edge = 1 - Math.min(1, distance / 0.075);
				const index = (y * width + x) * 4;
				image.data[index] = color.r * 255;
				image.data[index + 1] = color.g * 255;
				image.data[index + 2] = color.b * 255;
				image.data[index + 3] = edge * 62;
			}
		}
		context.putImageData(image, 0, 0);
	}
	return canvasTexture(canvas);
}

export function makeBackdrop(theme: Theme): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 4;
	canvas.height = 256;
	const context = canvas.getContext('2d')!;
	const gradient = context.createLinearGradient(0, 0, 0, 256);
	gradient.addColorStop(0, theme.skyTop);
	gradient.addColorStop(1, theme.skyBottom);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 4, 256);
	return canvasTexture(canvas);
}

export function makeHalo(color: string): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(64, 64, 2, 64, 64, 64);
	gradient.addColorStop(0, color);
	gradient.addColorStop(0.3, `${color}88`);
	gradient.addColorStop(1, `${color}00`);
	context.fillStyle = gradient;
	context.fillRect(0, 0, 128, 128);
	return canvasTexture(canvas);
}

export function makeDashes(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = 32;
	canvas.height = 4;
	const context = canvas.getContext('2d')!;
	context.fillStyle = '#000';
	context.fillRect(0, 0, 32, 4);
	context.fillStyle = '#fff';
	context.fillRect(0, 0, 18, 4);
	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = THREE.RepeatWrapping;
	return texture;
}

/** A soft blob under each node. Unlike a shadow map, it can never fall onto the wrong plate. */
export function makeContactShadow(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 128;
	const context = canvas.getContext('2d')!;
	const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 64);
	gradient.addColorStop(0, 'rgba(0,0,0,0.75)');
	gradient.addColorStop(0.55, 'rgba(0,0,0,0.32)');
	gradient.addColorStop(1, 'rgba(0,0,0,0)');
	context.fillStyle = gradient;
	context.fillRect(0, 0, 128, 128);
	return canvasTexture(canvas);
}
