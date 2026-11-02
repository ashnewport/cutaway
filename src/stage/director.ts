import gsap from 'gsap';
import type { AudioCue, CameraShot, Scene, Script } from '../core/index.ts';

export interface CameraState {
	x: number;
	y: number;
	z: number;
	radius: number;
	azimuth: number;
	elevation: number;
}

export interface PacketState {
	progress: number;
}

export interface RouteActivity {
	hot: number;
	warm: number;
}

export interface ArrivalState {
	node: string;
	ring: number;
}

/** Everything that changes over time. GSAP writes it, and the stage only reads it. */
export interface FrameState {
	rise: number;
	camera: CameraState;
	focus: Record<string, number>;
	packets: PacketState[];
	activity: RouteActivity[];
	arrivals: ArrivalState[];
	sourceGlow: { node: string; value: number }[];
}

function shotValues(shot: CameraShot): CameraState {
	return {
		x: shot.target[0],
		y: shot.target[1],
		z: shot.target[2],
		radius: shot.radius,
		azimuth: shot.azimuth,
		elevation: shot.elevation
	};
}

export interface DirectorEvents {
	onCue: (cue: AudioCue) => void;
	onEnd: () => void;
}

/**
 * Turns the pure script into one paused GSAP timeline. Every tween is a fromTo with
 * immediateRender off, so any time can be sought in any order and looks identical.
 * That property is what makes scrubbing and frame-accurate export reliable.
 */
export class Director {
	readonly timeline: gsap.core.Timeline;
	readonly state: FrameState;
	readonly script: Script;
	/** Packets across all steps, in the same order as state.packets. */
	readonly packetIndex: { step: number; packet: Script['steps'][number]['packets'][number] }[] = [];
	private stopAt: number | null = null;
	loop = false;

	constructor(scene: Scene, script: Script, events: DirectorEvents) {
		this.script = script;
		const focus: Record<string, number> = {};
		scene.layers.forEach((layer) => (focus[`l${layer.index}`] = 1));

		this.state = {
			rise: 0.02,
			camera: { ...shotValues(script.overview), radius: script.overview.radius * 1.3 },
			focus,
			packets: [],
			activity: [],
			arrivals: [],
			sourceGlow: []
		};

		const timeline = gsap.timeline({ paused: true, onComplete: () => events.onEnd() });
		this.timeline = timeline;
		const base = { immediateRender: false };

		const introFrom: CameraState = {
			...shotValues(script.overview),
			radius: script.overview.radius * 1.3,
			azimuth: script.overview.azimuth - 0.7,
			elevation: script.overview.elevation + 0.5
		};
		timeline.fromTo(
			this.state,
			{ rise: 0.02 },
			{ rise: 1, duration: 1.7, ease: 'back.out(1.5)', ...base },
			0.1
		);
		timeline.fromTo(
			this.state.camera,
			introFrom,
			{
				...shotValues(script.overview),
				duration: script.introDuration,
				ease: 'power2.inOut',
				...base
			},
			0
		);

		let previousShot = shotValues(script.overview);
		let previousFocus = { ...focus };

		for (const step of script.steps) {
			const nextShot = shotValues(step.shot);
			timeline.fromTo(
				this.state.camera,
				{ ...previousShot },
				{
					...nextShot,
					duration: step.shotDuration,
					ease: 'power2.inOut',
					...base
				},
				step.start
			);
			previousShot = nextShot;

			const nextFocus: Record<string, number> = {};
			step.focus.forEach((value, index) => (nextFocus[`l${index}`] = value));
			timeline.fromTo(
				this.state.focus,
				{ ...previousFocus },
				{
					...nextFocus,
					duration: step.shotDuration * 0.75,
					ease: 'power1.inOut',
					...base
				},
				step.start
			);
			previousFocus = nextFocus;

			for (const packet of step.packets) {
				const motion: PacketState = { progress: 0 };
				const activity: RouteActivity = { hot: 0, warm: 0 };
				this.state.packets.push(motion);
				this.state.activity.push(activity);
				this.packetIndex.push({ step: step.index, packet });
				const arrive = packet.start + packet.travel;

				timeline.fromTo(
					motion,
					{ progress: 0 },
					{
						progress: 1,
						duration: packet.travel,
						ease: 'power1.inOut',
						...base
					},
					packet.start
				);
				timeline.fromTo(
					activity,
					{ hot: 0 },
					{ hot: 1, duration: 0.2, ease: 'none', ...base },
					packet.start
				);
				timeline.fromTo(
					activity,
					{ hot: 1 },
					{ hot: 0, duration: 0.7, ease: 'power1.out', ...base },
					arrive
				);
				timeline.fromTo(
					activity,
					{ warm: 0 },
					{ warm: 1, duration: 0.3, ease: 'none', ...base },
					arrive
				);

				const edge = scene.diagram.edges.find((candidate) => candidate.id === packet.edge);
				if (edge) {
					const arrival: ArrivalState = { node: edge.to, ring: 0 };
					this.state.arrivals.push(arrival);
					timeline.fromTo(
						arrival,
						{ ring: 0 },
						{ ring: 1, duration: 0.9, ease: 'power2.out', ...base },
						arrive
					);
					const source = { node: edge.from, value: 0 };
					this.state.sourceGlow.push(source);
					timeline.fromTo(
						source,
						{ value: 0 },
						{ value: 1, duration: 0.18, ease: 'none', ...base },
						packet.start - 0.05
					);
					timeline.fromTo(
						source,
						{ value: 1 },
						{ value: 0, duration: 0.5, ease: 'none', ...base },
						packet.start + 0.13
					);
				}
			}
		}

		// Pull back to the whole stack at the end, so the lit path can be read in one view.
		const allFocused = { ...focus };
		timeline.fromTo(
			this.state.camera,
			{ ...previousShot },
			{
				...shotValues(script.overview),
				duration: script.duration - script.outroStart,
				ease: 'power2.inOut',
				...base
			},
			script.outroStart
		);
		timeline.fromTo(
			this.state.focus,
			{ ...previousFocus },
			{
				...allFocused,
				duration: 1.1,
				ease: 'power1.inOut',
				...base
			},
			script.outroStart
		);

		for (const cue of script.cues) {
			timeline.call(() => events.onCue(cue), undefined, cue.time);
		}
	}

	get time(): number {
		return this.timeline.time();
	}

	get duration(): number {
		return this.script.duration;
	}

	get playing(): boolean {
		return !this.timeline.paused() && this.timeline.progress() < 1;
	}

	/** The step under the playhead, or -1 during the intro. */
	stepAt(time: number): number {
		const { steps } = this.script;
		if (steps.length === 0 || time < steps[0].start) return -1;
		let low = 0;
		let high = steps.length - 1;
		while (low < high) {
			const mid = Math.ceil((low + high) / 2);
			if (steps[mid].start <= time) low = mid;
			else high = mid - 1;
		}
		return low;
	}

	play(): void {
		this.stopAt = null;
		if (this.timeline.progress() >= 1) this.timeline.seek(0, true);
		this.timeline.play();
	}

	pause(): void {
		this.stopAt = null;
		this.timeline.pause();
	}

	/** Seeks silently, keeping the current play or pause state. */
	seek(time: number): void {
		this.stopAt = null;
		this.timeline.seek(Math.max(0, Math.min(this.duration, time)), true);
	}

	/** Plays one step from its start, then stops. Used by the step buttons while paused. */
	playStep(index: number): void {
		const step = this.script.steps[index];
		if (!step) return;
		this.timeline.seek(step.start, true);
		this.stopAt = step.end;
		this.timeline.play();
	}

	/** Jumps to the moment a step's packet is mid-flight. Used while scrubbing to a paused step. */
	seekStep(index: number): void {
		const step = this.script.steps[index];
		if (step) this.seek(step.start);
	}

	/** Called every frame. Ends a single-step playback on the exact boundary. */
	update(): void {
		if (this.stopAt !== null && this.timeline.time() >= this.stopAt) {
			const stop = this.stopAt;
			this.stopAt = null;
			this.timeline.pause();
			this.timeline.seek(stop, true);
		}
	}

	dispose(): void {
		this.timeline.kill();
	}
}
