import { ApiError, api as default_api, type Change } from './api';
import { to_entries, type Entry } from './entries';
import type { Planner } from './planner.svelte';
import { has_settings, normalize_settings, type Settings } from './settings';

export const SYNC_KEY = 'yearly-overview:sync:v2';

const PUSH_DELAY_MS = 400;
const POLL_INTERVAL_MS = 30_000;
const PUSH_BATCH_SIZE = 1000;
/** Statuses meaning "the server won't accept this data", as opposed to being unreachable. */
const REJECTED = new Set([400, 413, 422]);

export type SyncStatus =
	/** No sync server (static hosting), or it hasn't been reached yet. */
	'unavailable' | 'syncing' | 'synced' | 'offline' | 'error';

/** Persisted so unsent changes survive reloads and going offline. */
type Meta = {
	/** The server revision this device has caught up to. */
	rev: number;
	/** Local changes not yet accepted by the server. `null` deletes the day. */
	pending: Record<string, Entry | null>;
	/** Settings changed locally and not yet accepted by the server. */
	pending_settings?: Settings;
};

type Api = Pick<typeof default_api, 'pull' | 'push'>;
type MetaStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Keeps the planner in sync with the server it was loaded from. There are no accounts: the
 * server holds one planner and is only reachable by its owner (e.g. over a private tailnet).
 * Local changes are queued and pushed, then anything newer on the server is pulled. The last
 * write for a day wins.
 */
export class Sync {
	status = $state<SyncStatus>('unavailable');
	message = $state('');
	/** Number of local changes waiting to be sent. */
	pending = $state(0);

	#planner: Planner;
	#storage: MetaStorage | undefined;
	#api: Api;
	#push_timer: ReturnType<typeof setTimeout> | undefined;
	#running: Promise<void> | null = null;
	#again = false;
	/** How many queued changes the server refused in the last push. */
	#rejected = 0;

	constructor(planner: Planner, storage: MetaStorage | undefined, api: Api = default_api) {
		this.#planner = planner;
		this.#storage = storage;
		this.#api = api;
		planner.onchange = (keys) => this.#track(keys);
		planner.onsettingschange = () => this.#track_settings();
		this.pending = this.#count_pending(this.#read());
	}

	/** Whether this device has been connected to the server (and queues changes for it). */
	get connected() {
		return this.#read() !== null;
	}

	// ── Persisted state ──────────────────────────────────────────────────────

	/** Always read fresh: another tab may have changed it. */
	#read(): Meta | null {
		try {
			const value = JSON.parse(this.#storage?.getItem(SYNC_KEY) ?? 'null');
			if (typeof value?.rev !== 'number') return null;
			return {
				rev: value.rev,
				pending: value.pending ?? {},
				pending_settings: value.pending_settings
			};
		} catch {
			return null;
		}
	}

	#count_pending(meta: Meta | null) {
		return Object.keys(meta?.pending ?? {}).length + (meta?.pending_settings ? 1 : 0);
	}

	#write(meta: Meta | null) {
		this.pending = this.#count_pending(meta);
		try {
			if (meta) this.#storage?.setItem(SYNC_KEY, JSON.stringify(meta));
			else this.#storage?.removeItem(SYNC_KEY);
		} catch {
			// Storage is full or blocked; syncing still works for this page load.
		}
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/** Connects (or reconnects) and keeps syncing. Returns a cleanup function. */
	start() {
		void this.sync();

		const on_visible = () => {
			if (document.visibilityState === 'visible') void this.sync();
		};
		const on_online = () => void this.sync();
		const poll = setInterval(() => {
			if (document.visibilityState === 'visible' && this.connected) void this.sync();
		}, POLL_INTERVAL_MS);

		document.addEventListener('visibilitychange', on_visible);
		window.addEventListener('focus', on_online);
		window.addEventListener('online', on_online);

		return () => {
			clearInterval(poll);
			clearTimeout(this.#push_timer);
			document.removeEventListener('visibilitychange', on_visible);
			window.removeEventListener('focus', on_online);
			window.removeEventListener('online', on_online);
		};
	}

	/** Another tab changed the queue. */
	storage_changed() {
		this.pending = this.#count_pending(this.#read());
	}

	/**
	 * First contact with a server (or one whose data was reset): days that only exist on this
	 * device are uploaded, days the server already has are taken from the server.
	 */
	async #connect() {
		const { rev, changes, settings } = await this.#api.pull(0);
		const on_server = Object.fromEntries(changes.map((change) => [change.date, true]));

		const pending: Meta['pending'] = {};
		const local = $state.snapshot(this.#planner.entries) as Record<string, Entry>;
		for (const [key, entry] of Object.entries(local)) {
			if (!(key in on_server)) pending[key] = entry;
		}

		// Settings work like days: the server's win, unless it has none yet.
		let pending_settings: Settings | undefined;
		const local_settings = $state.snapshot(this.#planner.settings) as Settings;
		if (settings && has_settings(normalize_settings(settings))) {
			this.#planner.apply_remote_settings(normalize_settings(settings));
		} else if (has_settings(local_settings)) {
			pending_settings = local_settings;
		}

		this.#write({ rev, pending, pending_settings });
		this.#planner.apply_remote(
			changes
				.filter((change) => !(change.date in pending))
				.map((change) => [change.date, this.#clean(change)])
		);
	}

	// ── Syncing ──────────────────────────────────────────────────────────────

	#track(keys: string[]) {
		const meta = this.#read();
		if (!meta) return;

		for (const key of keys) {
			const entry = this.#planner.entries[key];
			meta.pending[key] = entry ? ($state.snapshot(entry) as Entry) : null;
		}
		this.#write(meta);
		this.#schedule_push();
	}

	#track_settings() {
		const meta = this.#read();
		if (!meta) return;

		meta.pending_settings = $state.snapshot(this.#planner.settings) as Settings;
		this.#write(meta);
		this.#schedule_push();
	}

	#schedule_push() {
		clearTimeout(this.#push_timer);
		this.#push_timer = setTimeout(() => void this.sync(), PUSH_DELAY_MS);
	}

	/** Pushes queued changes, then pulls newer ones. Safe to call at any time. */
	sync(): Promise<void> {
		if (this.#running) {
			this.#again = true;
			return this.#running;
		}

		this.#running = this.#run().finally(() => {
			this.#running = null;
			if (this.#again) {
				this.#again = false;
				void this.sync();
			}
		});
		return this.#running;
	}

	async #run() {
		if (this.connected) this.status = 'syncing';

		try {
			if (!this.connected) await this.#connect();
			this.status = 'syncing';

			let refused: ApiError | null = null;
			try {
				await this.#push();
			} catch (error) {
				// Refused changes are already out of the queue; still pull everything else.
				if (!(error instanceof ApiError && REJECTED.has(error.status))) throw error;
				refused = error;
			}
			await this.#pull();
			if (refused) throw refused;
			this.status = 'synced';
			this.message = '';
		} catch (error) {
			if (!(error instanceof ApiError)) throw error;

			if (!this.connected) {
				// No sync server here (static hosting) or not reachable yet: stay local.
				this.status = 'unavailable';
			} else if (error.status === 0) {
				this.status = 'offline';
			} else {
				this.status = 'error';
				this.message = error.message;
			}
		}
	}

	async #push() {
		this.#rejected = 0;
		const meta = this.#read();

		const settings = meta?.pending_settings;
		if (settings) {
			try {
				await this.#api.push([], settings);
			} catch (error) {
				if (!(error instanceof ApiError && REJECTED.has(error.status))) throw error;
				this.#rejected++;
			}
			this.#forget([], settings);
		}

		const sent = Object.entries(meta?.pending ?? {});
		for (let i = 0; i < sent.length; i += PUSH_BATCH_SIZE) {
			await this.#push_batch(sent.slice(i, i + PUSH_BATCH_SIZE));
		}

		if (this.#rejected) {
			throw new ApiError(
				400,
				`The server refused ${this.#rejected === 1 ? '1 change' : `${this.#rejected} changes`}; they stay on this device only.`
			);
		}
	}

	/**
	 * Sends a batch. If the server refuses it, the batch is split until the refused changes are
	 * isolated, so one bad change can't block everything else from syncing.
	 */
	async #push_batch(batch: [string, Entry | null][]) {
		try {
			await this.#api.push(batch.map(([date, entry]) => ({ date, entry })));
		} catch (error) {
			if (!(error instanceof ApiError && REJECTED.has(error.status))) throw error;
			if (batch.length > 1) {
				const middle = Math.ceil(batch.length / 2);
				await this.#push_batch(batch.slice(0, middle));
				await this.#push_batch(batch.slice(middle));
				return;
			}
			this.#rejected++;
		}
		this.#forget(batch);
	}

	/** Removes sent items from the queue, unless they were changed again in the meantime. */
	#forget(batch: [string, Entry | null][], settings?: Settings) {
		const current = this.#read();
		if (!current) return;
		for (const [key, entry] of batch) {
			if (JSON.stringify(current.pending[key]) === JSON.stringify(entry)) {
				delete current.pending[key];
			}
		}
		if (settings && JSON.stringify(current.pending_settings) === JSON.stringify(settings)) {
			delete current.pending_settings;
		}
		this.#write(current);
	}

	async #pull() {
		const before = this.#read();
		if (!before) return;

		const { rev, changes, settings } = await this.#api.pull(before.rev);

		if (rev < before.rev) {
			// The server's data was reset (e.g. a fresh install): give it this device's copy.
			this.#write(null);
			await this.#connect();
			await this.#push();
			return;
		}

		const meta = this.#read();
		if (!meta) return;

		if (settings && !meta.pending_settings) {
			this.#planner.apply_remote_settings(normalize_settings(settings));
		}

		// Local edits that haven't reached the server yet win over what we just pulled.
		this.#planner.apply_remote(
			changes
				.filter((change) => !(change.date in meta.pending))
				.map((change) => [change.date, this.#clean(change)])
		);
		this.#write({ ...meta, rev: Math.max(meta.rev, rev) });
	}

	/** Server data is validated like anything else read from outside. */
	#clean(change: Change): Entry | null {
		if (!change.entry) return null;
		return to_entries({ [change.date]: change.entry })[change.date] ?? null;
	}
}

export const STATUS_LABELS: Record<SyncStatus, string> = {
	unavailable: 'Not syncing',
	syncing: 'Syncing…',
	synced: 'Synced',
	offline: 'Offline',
	error: 'Sync error'
};
