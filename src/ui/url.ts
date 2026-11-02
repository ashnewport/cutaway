export function readParam(name: string): string | null {
	return new URLSearchParams(location.search).get(name);
}

/** Keeps the address bar honest, so a reload shows what is on screen rather than an old example. */
export function writeExampleParam(id: string | null): void {
	const url = new URL(location.href);
	if (id) url.searchParams.set('example', id);
	else url.searchParams.delete('example');
	history.replaceState(null, '', url);
}
