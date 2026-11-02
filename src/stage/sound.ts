import type { AudioCue, Script, SoundPack } from '../core/index.ts';

type Ctx = BaseAudioContext;

function frequency(semitones: number): number {
	return 220 * Math.pow(2, semitones / 12);
}

function noiseBuffer(context: Ctx, seconds: number): AudioBuffer {
	const buffer = context.createBuffer(
		1,
		Math.floor(context.sampleRate * seconds),
		context.sampleRate
	);
	const data = buffer.getChannelData(0);
	// A fixed-seed generator keeps exported audio identical between runs.
	let seed = 22222;
	for (let index = 0; index < data.length; index++) {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		data[index] = seed / 2147483648 - 1;
	}
	return buffer;
}

function tone(
	context: Ctx,
	out: AudioNode,
	type: OscillatorType,
	hz: number,
	when: number,
	attack: number,
	decay: number,
	peak: number,
	glideTo?: number
): void {
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = type;
	oscillator.frequency.setValueAtTime(hz, when);
	if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, when + attack + decay);
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), when + attack);
	gain.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
	oscillator.connect(gain).connect(out);
	oscillator.start(when);
	oscillator.stop(when + attack + decay + 0.02);
}

function whoosh(
	context: Ctx,
	out: AudioNode,
	when: number,
	from: number,
	to: number,
	seconds: number,
	peak: number
): void {
	const source = context.createBufferSource();
	source.buffer = noiseBuffer(context, seconds + 0.05);
	const filter = context.createBiquadFilter();
	filter.type = 'bandpass';
	filter.Q.value = 2.2;
	filter.frequency.setValueAtTime(from, when);
	filter.frequency.exponentialRampToValueAtTime(to, when + seconds);
	const gain = context.createGain();
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.exponentialRampToValueAtTime(peak, when + seconds * 0.4);
	gain.gain.exponentialRampToValueAtTime(0.0001, when + seconds);
	source.connect(filter).connect(gain).connect(out);
	source.start(when);
	source.stop(when + seconds + 0.04);
}

function strike(
	context: Ctx,
	out: AudioNode,
	pack: SoundPack,
	hz: number,
	when: number,
	peak: number
): void {
	switch (pack) {
		case 'marimba':
			tone(context, out, 'sine', hz, when, 0.004, 0.42, peak);
			tone(context, out, 'sine', hz * 3.93, when, 0.002, 0.11, peak * 0.32);
			break;
		case 'glass':
			tone(context, out, 'sine', hz * 2, when, 0.006, 0.9, peak * 0.55);
			tone(context, out, 'sine', hz * 2.76, when, 0.004, 0.55, peak * 0.22);
			tone(context, out, 'triangle', hz, when, 0.012, 0.5, peak * 0.3);
			break;
		case 'chip':
			tone(context, out, 'square', hz, when, 0.002, 0.12, peak * 0.32);
			tone(context, out, 'square', hz * 1.5, when + 0.07, 0.002, 0.13, peak * 0.28);
			break;
	}
}

/** Works on a live AudioContext and on an OfflineAudioContext, so exports match playback. */
export function synthCue(
	context: Ctx,
	out: AudioNode,
	cue: AudioCue,
	when: number,
	pack: SoundPack
): void {
	const hz = frequency(cue.pitch);
	switch (cue.type) {
		case 'swell':
			whoosh(context, out, when, 180, 1200, 1.6, 0.16);
			tone(context, out, 'sine', frequency(-24), when, 0.5, 1.5, 0.2);
			break;
		case 'depart':
			tone(
				context,
				out,
				pack === 'chip' ? 'square' : 'sine',
				hz * 0.5,
				when,
				0.003,
				0.09,
				cue.gain * 0.16,
				hz
			);
			break;
		case 'arrive':
			strike(context, out, pack, hz, when, cue.gain * 0.5);
			break;
		case 'plunge':
			whoosh(context, out, when, 2200, 260, 0.75, 0.2);
			tone(context, out, 'sine', hz * 1.5, when, 0.02, 0.7, cue.gain * 0.18, hz * 0.4);
			break;
		case 'rise':
			whoosh(context, out, when, 260, 2200, 0.75, 0.17);
			tone(context, out, 'sine', hz * 0.5, when, 0.02, 0.7, cue.gain * 0.18, hz * 1.5);
			break;
		case 'error':
			tone(context, out, 'sawtooth', 110, when, 0.004, 0.32, cue.gain * 0.22, 82);
			tone(context, out, 'square', 116, when + 0.03, 0.004, 0.26, cue.gain * 0.12, 80);
			break;
	}
}

function makeReverb(context: Ctx): ConvolverNode {
	const seconds = 2.2;
	const length = Math.floor(context.sampleRate * seconds);
	const impulse = context.createBuffer(2, length, context.sampleRate);
	for (let channel = 0; channel < 2; channel++) {
		const data = impulse.getChannelData(channel);
		let seed = 1234 + channel * 777;
		for (let index = 0; index < length; index++) {
			seed = (seed * 1664525 + 1013904223) >>> 0;
			data[index] = (seed / 2147483648 - 1) * Math.pow(1 - index / length, 3.2);
		}
	}
	const reverb = context.createConvolver();
	reverb.buffer = impulse;
	return reverb;
}

/** The dry and reverb signal path, shared by live playback and offline render. */
function makeChain(context: Ctx, destination: AudioNode): { input: GainNode; master: GainNode } {
	const input = context.createGain();
	const master = context.createGain();
	const compressor = context.createDynamicsCompressor();
	const send = context.createGain();
	send.gain.value = 0.26;
	const reverb = makeReverb(context);
	input.connect(compressor);
	input.connect(send).connect(reverb).connect(compressor);
	compressor.connect(master).connect(destination);
	return { input, master };
}

function startDrone(
	context: Ctx,
	out: AudioNode,
	when: number,
	stop?: number
): { nodes: AudioScheduledSourceNode[]; gain: GainNode } {
	const gain = context.createGain();
	gain.gain.value = 0.0001;
	const filter = context.createBiquadFilter();
	filter.type = 'lowpass';
	filter.frequency.value = 420;
	const lfo = context.createOscillator();
	lfo.frequency.value = 0.07;
	const lfoDepth = context.createGain();
	lfoDepth.gain.value = 170;
	lfo.connect(lfoDepth).connect(filter.frequency);
	const nodes: AudioScheduledSourceNode[] = [lfo];
	for (const [hz, detune] of [
		[55, -6],
		[55, 7],
		[82.41, 3],
		[110, -4]
	]) {
		const oscillator = context.createOscillator();
		oscillator.type = 'sawtooth';
		oscillator.frequency.value = hz;
		oscillator.detune.value = detune;
		oscillator.connect(filter);
		nodes.push(oscillator);
	}
	filter.connect(gain).connect(out);
	for (const node of nodes) {
		node.start(when);
		if (stop !== undefined) node.stop(stop);
	}
	return { nodes, gain };
}

/** Live sound. The context is created on first use, because browsers require a user gesture. */
export class SoundEngine {
	private context: AudioContext | null = null;
	private chain: { input: GainNode; master: GainNode } | null = null;
	private drone: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;
	muted = false;
	volume = 0.8;
	pack: SoundPack = 'marimba';
	ambience = true;
	playing = false;

	/** Call from a user gesture. Safe to call repeatedly. */
	unlock(): void {
		if (!this.context) {
			const context = new AudioContext();
			this.context = context;
			this.chain = makeChain(context, context.destination);
			this.applyVolume();
		}
		if (this.context.state === 'suspended') void this.context.resume();
		this.syncDrone();
	}

	get ready(): boolean {
		return this.context?.state === 'running';
	}

	private applyVolume(): void {
		if (!this.chain || !this.context) return;
		const level = this.muted ? 0 : this.volume;
		this.chain.master.gain.setTargetAtTime(level, this.context.currentTime, 0.02);
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.applyVolume();
	}

	setVolume(volume: number): void {
		this.volume = volume;
		this.applyVolume();
	}

	setPlaying(playing: boolean): void {
		this.playing = playing;
		this.syncDrone();
	}

	setAmbience(on: boolean): void {
		this.ambience = on;
		this.syncDrone();
	}

	private syncDrone(): void {
		if (!this.context || !this.chain) return;
		const want = this.playing && this.ambience;
		if (want && !this.drone)
			this.drone = startDrone(this.context, this.chain.input, this.context.currentTime);
		if (this.drone) {
			this.drone.gain.gain.setTargetAtTime(want ? 0.05 : 0.0001, this.context.currentTime, 0.5);
		}
	}

	fire(cue: AudioCue): void {
		if (!this.context || !this.chain || this.context.state !== 'running' || this.muted) return;
		synthCue(this.context, this.chain.input, cue, this.context.currentTime + 0.005, this.pack);
	}

	/** A one-off sample of the current sound pack, for the sound menu. */
	preview(): void {
		this.unlock();
		this.fire({ time: 0, type: 'arrive', pitch: 7, gain: 0.85 });
	}

	dispose(): void {
		void this.context?.close();
		this.context = null;
		this.chain = null;
		this.drone = null;
	}
}

/** Renders a script's whole soundtrack faster than real time for video export. */
export async function renderSoundtrack(
	script: Script,
	from: number,
	to: number,
	options: { pack: SoundPack; ambience: boolean; volume: number }
): Promise<AudioBuffer> {
	const sampleRate = 48000;
	const length = Math.ceil((to - from) * sampleRate);
	const context = new OfflineAudioContext(2, length, sampleRate);
	const chain = makeChain(context, context.destination);
	chain.master.gain.value = options.volume;
	if (options.ambience) {
		const drone = startDrone(context, chain.input, 0, to - from);
		drone.gain.gain.setTargetAtTime(0.05, 0, 0.5);
	}
	for (const cue of script.cues) {
		if (cue.time >= from && cue.time < to) {
			synthCue(context, chain.input, cue, cue.time - from, options.pack);
		}
	}
	return context.startRendering();
}
