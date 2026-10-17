/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Makes the app load without a connection. Entries already live in localStorage and the
// sync queue sends changes once the server is reachable again.
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `yearly-overview-${version}`;
const APP_SHELL = '/';
/** Everything this version could ever request; anything else (like /api) is left alone. */
const KNOWN = new Set([...build, ...files]);

/**
 * Only the app shell is downloaded up front: the page and what it references. Chunks loaded on
 * demand (like the large public holiday data) are cached the first time they are used.
 */
async function precache() {
	const cache = await caches.open(CACHE);
	const page = await fetch(APP_SHELL, { cache: 'reload' });
	if (!page.ok) throw new Error(`Couldn’t fetch the app (${page.status})`);

	const html = await page.clone().text();
	const referenced = new Set(
		[...html.matchAll(/_app\/immutable\/[^"'`)\s]+/g)].map((match) => `/${match[0]}`)
	);

	await cache.put(APP_SHELL, page);
	await cache.addAll([...files, ...[...referenced].filter((path) => KNOWN.has(path))]);
}

sw.addEventListener('install', (event) => {
	event.waitUntil(precache().then(() => sw.skipWaiting()));
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
			)
			.then(() => sw.clients.claim())
	);
});

async function cache_first(request: Request, path: string) {
	const cache = await caches.open(CACHE);
	const cached = await cache.match(path);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) await cache.put(path, response.clone());
	return response;
}

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	if (request.method !== 'GET' || url.origin !== sw.location.origin) return;

	if (KNOWN.has(url.pathname)) {
		// Build files are versioned, so a cached copy is always right.
		event.respondWith(cache_first(request, url.pathname));
		return;
	}

	if (request.mode === 'navigate') {
		// Prefer the network for pages so a new deploy shows up, fall back to the cached app.
		event.respondWith(
			fetch(request).catch(async () => (await caches.match(APP_SHELL)) ?? Response.error())
		);
	}
	// Everything else, including the API, goes to the network untouched.
});
