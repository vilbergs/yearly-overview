import { describe, expect, it } from 'vitest';
import { ApiError, type Change } from './api';
import type { Entry } from './entries';
import { Planner } from './planner.svelte';
import { SYNC_KEY, Sync } from './sync.svelte';

function memory_storage() {
	const store = new Map<string, string>();
	return {
		store,
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key)
	} as unknown as Storage & { store: Map<string, string> };
}

/** An in-memory stand-in for the server with the same last-write-wins semantics. */
function fake_server() {
	let rev = 0;
	let online = true;
	let available = true;
	const rows = new Map<string, { entry: Entry | null; rev: number }>();
	let settings: { value: unknown; rev: number } = { value: { categories: {} }, rev: 0 };
	const check = () => {
		if (!available) throw new ApiError(404, 'Sync is not available on this server.');
		if (!online) throw new ApiError(0, 'offline');
	};

	const server = {
		rows,
		get settings() {
			return settings.value;
		},
		write(date: string, entry: Entry | null) {
			rows.set(date, { entry, rev: ++rev });
		},
		write_settings(value: unknown) {
			settings = { value, rev: ++rev };
		},
		set_online: (value: boolean) => (online = value),
		set_available: (value: boolean) => (available = value),
		/** Like reinstalling the server with an empty database. */
		reset() {
			rev = 0;
			rows.clear();
			settings = { value: { categories: {} }, rev: 0 };
		},
		api: {
			pull: async (since: number) => {
				check();
				const changes: Change[] = [...rows]
					.filter(([, row]) => row.rev > since && (since > 0 || row.entry))
					.map(([date, row]) => ({ date, entry: row.entry }));
				return {
					rev,
					changes,
					...(settings.rev > since ? { settings: settings.value as never } : {})
				};
			},
			push: async (changes: Change[], value?: unknown) => {
				check();
				rev++;
				for (const { date, entry } of changes) rows.set(date, { entry, rev });
				if (value) settings = { value, rev };
				return { rev };
			}
		}
	};
	return server;
}

const trip: Entry = { title: 'Trip', description: '' };

async function connected() {
	const storage = memory_storage();
	const server = fake_server();
	const planner = new Planner(storage);
	const sync = new Sync(planner, storage, server.api);
	await sync.sync();
	return { storage, server, planner, sync };
}

describe('Sync', () => {
	it('merges the device into the server on first contact', async () => {
		const storage = memory_storage();
		const server = fake_server();
		server.write('2026-01-01', { title: 'From server', description: '' });
		server.write('2026-01-02', { title: 'Server wins', description: '' });

		const planner = new Planner(storage);
		planner.set(['2026-01-02'], { title: 'Local copy', description: '' });
		planner.set(['2026-01-03'], { title: 'Only local', description: '' });

		const sync = new Sync(planner, storage, server.api);
		await sync.sync();

		expect(planner.entries['2026-01-01'].title).toBe('From server');
		expect(planner.entries['2026-01-02'].title).toBe('Server wins');
		expect(server.rows.get('2026-01-03')?.entry?.title).toBe('Only local');
		expect(sync.status).toBe('synced');
		expect(sync.connected).toBe(true);
		expect(sync.pending).toBe(0);
	});

	it('stays local when there is no sync server', async () => {
		const storage = memory_storage();
		const server = fake_server();
		server.set_available(false);
		const planner = new Planner(storage);
		const sync = new Sync(planner, storage, server.api);
		await sync.sync();

		expect(sync.status).toBe('unavailable');
		expect(sync.connected).toBe(false);
		planner.set(['2026-01-01'], trip);
		expect(sync.pending).toBe(0);
		expect(storage.store.has(SYNC_KEY)).toBe(false);
	});

	it('connects later if the server was unreachable at first', async () => {
		const storage = memory_storage();
		const server = fake_server();
		server.set_online(false);
		const planner = new Planner(storage);
		planner.set(['2026-02-01'], trip);
		const sync = new Sync(planner, storage, server.api);
		await sync.sync();
		expect(sync.status).toBe('unavailable');

		server.set_online(true);
		await sync.sync();
		expect(sync.status).toBe('synced');
		expect(server.rows.get('2026-02-01')?.entry).toEqual(trip);
	});

	it('pushes local edits and pulls remote ones', async () => {
		const { server, planner, sync } = await connected();

		planner.set(['2026-05-01'], trip);
		await sync.sync();
		expect(server.rows.get('2026-05-01')?.entry).toEqual(trip);

		server.write('2026-05-02', { title: 'From phone', description: '' });
		server.write('2026-05-01', null);
		await sync.sync();
		expect(planner.entries['2026-05-02'].title).toBe('From phone');
		expect(planner.entries['2026-05-01']).toBeUndefined();
	});

	it('queues changes while offline and sends them later', async () => {
		const { storage, server, planner, sync } = await connected();

		server.set_online(false);
		planner.set(['2026-06-01'], trip);
		await sync.sync();
		expect(sync.status).toBe('offline');
		expect(sync.pending).toBe(1);
		expect(JSON.parse(storage.store.get(SYNC_KEY)!).pending).toHaveProperty('2026-06-01');

		server.set_online(true);
		await sync.sync();
		expect(sync.status).toBe('synced');
		expect(server.rows.get('2026-06-01')?.entry).toEqual(trip);
	});

	it('keeps unsent local edits over older server data for that day', async () => {
		const { server, planner, sync } = await connected();

		server.set_online(false);
		planner.set(['2026-07-01'], { title: 'Mine', description: '' });
		await sync.sync();
		server.write('2026-07-01', { title: 'Theirs, earlier', description: '' });

		server.set_online(true);
		await sync.sync();
		expect(planner.entries['2026-07-01'].title).toBe('Mine');
		expect(server.rows.get('2026-07-01')?.entry?.title).toBe('Mine');
	});

	it('isolates a refused change instead of blocking the queue', async () => {
		const { server, planner, sync } = await connected();
		const push = server.api.push;
		server.api.push = async (changes, settings) => {
			if (changes.some((change) => change.entry?.title === 'bad')) {
				throw new ApiError(422, 'Unprocessable');
			}
			return push(changes, settings);
		};
		server.write('2026-12-01', { title: 'Remote', description: '' });

		planner.set(['2026-11-01', '2026-11-02', '2026-11-04'], trip);
		planner.set(['2026-11-03'], { title: 'bad', description: '' });
		await sync.sync();

		expect(sync.status).toBe('error');
		expect(sync.message).toMatch(/refused 1 change/);
		expect(sync.pending).toBe(0);
		for (const day of ['01', '02', '04']) {
			expect(server.rows.get(`2026-11-${day}`)?.entry).toEqual(trip);
		}
		expect(planner.entries['2026-12-01'].title).toBe('Remote');
		expect(planner.entries['2026-11-03'].title).toBe('bad');

		planner.set(['2026-11-05'], trip);
		await sync.sync();
		expect(sync.status).toBe('synced');
	});

	it('re-uploads everything when the server’s data was reset', async () => {
		const { server, planner, sync } = await connected();
		planner.set(['2026-08-01', '2026-08-02'], trip);
		planner.set_settings({ categories: { red: 'Work' } });
		await sync.sync();

		server.reset();
		await sync.sync();
		expect(server.rows.get('2026-08-01')?.entry).toEqual(trip);
		expect(server.rows.get('2026-08-02')?.entry).toEqual(trip);
		expect(server.settings).toEqual({ categories: { red: 'Work' } });
		expect(planner.entries['2026-08-01']).toEqual(trip);
	});

	it('counts queued settings in other tabs too', async () => {
		const { storage, server, planner, sync } = await connected();
		server.set_online(false);
		planner.set_settings({ categories: { red: 'Work' } });
		await sync.sync();

		const other_tab = new Sync(new Planner(storage), storage, server.api);
		other_tab.storage_changed();
		expect(other_tab.pending).toBe(1);
	});
});

describe('Sync settings', () => {
	it('uploads local category names when the server has none', async () => {
		const storage = memory_storage();
		const server = fake_server();
		const planner = new Planner(storage);
		planner.set_settings({ categories: { red: 'Work' } });

		await new Sync(planner, storage, server.api).sync();
		expect(server.settings).toEqual({ categories: { red: 'Work' } });
	});

	it('takes the server’s settings on first contact and syncs later changes both ways', async () => {
		const storage = memory_storage();
		const server = fake_server();
		server.write_settings({ categories: { green: 'Holiday' }, holiday_country: 'SE' });
		const planner = new Planner(storage);
		planner.set_settings({ categories: { red: 'Local only' } });

		const sync = new Sync(planner, storage, server.api);
		await sync.sync();
		expect(planner.settings).toEqual({ categories: { green: 'Holiday' }, holiday_country: 'SE' });

		planner.set_settings({ categories: { green: 'Holiday', blue: 'Sport' } });
		await sync.sync();
		expect(server.settings).toEqual({ categories: { green: 'Holiday', blue: 'Sport' } });

		server.write_settings({ categories: { green: 'Vacation' } });
		await sync.sync();
		expect(planner.settings).toEqual({ categories: { green: 'Vacation' } });
	});
});
