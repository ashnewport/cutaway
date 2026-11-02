export interface Theme {
	id: string;
	name: string;
	mode: 'light' | 'dark';
	/** Top and bottom of the backdrop gradient. */
	skyTop: string;
	skyBottom: string;
	ink: string;
	inkSoft: string;
	panel: string;
	/** One colour per plate, repeating if the diagram has more plates. */
	layerColors: string[];
	packet: string;
	credential: string;
	error: string;
	plateOpacity: number;
	bloom: number;
	outline: number;
	/** Rounded and physical, faceted and toy-like, or line art. */
	finish: 'satin' | 'faceted' | 'wire';
	radius: number;
	font: string;
	sound: SoundPack;
}

export type SoundPack = 'marimba' | 'glass' | 'chip';

export const FONT_STACKS: Record<string, { name: string; display: string; body: string }> = {
	archivo: {
		name: 'Archivo',
		display: '"Archivo Variable", "Helvetica Neue", Arial, sans-serif',
		body: '"Archivo Variable", "Helvetica Neue", Arial, sans-serif'
	},
	pixel: {
		name: 'Pixelify',
		display: '"Pixelify Sans", "Courier New", monospace',
		body: '"Archivo Variable", "Helvetica Neue", Arial, sans-serif'
	},
	system: {
		name: 'System',
		display: 'system-ui, sans-serif',
		body: 'system-ui, sans-serif'
	}
};

export const THEMES: Theme[] = [
	{
		id: 'survey',
		name: 'Survey map',
		mode: 'light',
		skyTop: '#EAF0F2',
		skyBottom: '#C3D2DA',
		ink: '#14233C',
		inkSoft: '#4D5F78',
		panel: '#F4F8F9',
		layerColors: ['#F0B429', '#1B9E85', '#3550C4', '#A12C71', '#5E6B73'],
		packet: '#E5175F',
		credential: '#7A1FD1',
		error: '#D72C16',
		plateOpacity: 0.86,
		bloom: 0,
		outline: 0.55,
		finish: 'satin',
		radius: 3,
		font: 'archivo',
		sound: 'marimba'
	},
	{
		id: 'shaft',
		name: 'Mine shaft',
		mode: 'dark',
		skyTop: '#201338',
		skyBottom: '#070B1F',
		ink: '#F2ECDD',
		inkSoft: '#A99FBC',
		panel: '#1A1230',
		layerColors: ['#FFB43B', '#29D3C2', '#8B6CFF', '#FF5C8A', '#7FA6C9'],
		packet: '#FFF3C4',
		credential: '#FF7BD5',
		error: '#FF5340',
		plateOpacity: 0.78,
		bloom: 0.32,
		outline: 0.35,
		finish: 'satin',
		radius: 3,
		font: 'archivo',
		sound: 'glass'
	},
	{
		id: 'blueprint',
		name: 'Blueprint',
		mode: 'dark',
		skyTop: '#1C55B4',
		skyBottom: '#0E3580',
		ink: '#F1F6FF',
		inkSoft: '#B8CDF2',
		panel: '#123F8F',
		layerColors: ['#DCE9FF', '#BFD6FF', '#A4C3FF', '#8AB0FF', '#739EF5'],
		packet: '#FFD84A',
		credential: '#FF9E7A',
		error: '#FF6464',
		plateOpacity: 0.14,
		bloom: 0,
		outline: 1,
		finish: 'wire',
		radius: 0,
		font: 'archivo',
		sound: 'glass'
	},
	{
		id: 'arcade',
		name: 'Arcade',
		mode: 'dark',
		skyTop: '#5B1FA8',
		skyBottom: '#D1307E',
		ink: '#FFF8E0',
		inkSoft: '#F4CBE8',
		panel: '#3D1278',
		layerColors: ['#FFD23F', '#3BE8B0', '#39A7FF', '#FF7A59', '#C8F560'],
		packet: '#FFFFFF',
		credential: '#FFD23F',
		error: '#FF2E4C',
		plateOpacity: 0.94,
		bloom: 0.2,
		outline: 0.9,
		finish: 'faceted',
		radius: 0,
		font: 'pixel',
		sound: 'chip'
	}
];

export function themeById(id: string): Theme {
	return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}

export function layerColor(theme: Theme, index: number): string {
	return theme.layerColors[index % theme.layerColors.length];
}
