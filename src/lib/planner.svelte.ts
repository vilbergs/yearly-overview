import { load_entries, save_entries, type Entries, type Entry } from './entries';
import {
	default_settings,
	load_settings,
	normalize_settings,
	save_settings,
	type Settings
} from './settings';

const HISTORY_LIMIT = 200;

function changed_keys(a: Entries, b: Entries) {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key])).sort();
}

/** The entries plus undo/redo history, persisted to storage after every change. */
export class Planner {
	entries = $state<Entries>({});
	settings = $state<Settings>(default_settings());
	save_failed = $state(false);
	can_undo = $state(false);
	can_redo = $state(false);

	/** Called with the keys of every local change (edits, undo, redo), e.g. to sync them. */
	onchange: ((keys: string[]) => void) | undefined;
	/** Called when the user changes settings (not for remote updates). */
	onsettingschange: (() => void) | undefined;

	#storage: Storage | undefined;
	#past: Entries[] = [];
	#future: Entries[] = [];

	constructor(storage: Storage | undefined) {
		this.#storage = storage;
		this.entries = load_entries(storage);
		this.settings = load_settings(storage);
		this.save_failed = storage === undefined;
	}

	set_settings(settings: Settings) {
		this.settings = normalize_settings(settings);
		save_settings(this.#storage, this.settings);
		this.onsettingschange?.();
	}

	apply_remote_settings(settings: Settings) {
		this.settings = normalize_settings(settings);
		save_settings(this.#storage, this.settings);
	}

	#snapshot(): Entries {
		return $state.snapshot(this.entries) as Entries;
	}

	#persist() {
		this.save_failed = !save_entries(this.#storage, this.#snapshot());
		this.can_undo = this.#past.length > 0;
		this.can_redo = this.#future.length > 0;
	}

	/** Writes `entry` (or removes the entry when null) on every key. Returns the keys that changed. */
	set(keys: string[], entry: Entry | null | ((current: Entry | undefined) => Entry | null)) {
		const before = this.#snapshot();

		for (const key of keys) {
			const next = typeof entry === 'function' ? entry(before[key]) : entry;
			if (next) {
				this.entries[key] = { ...next };
			} else {
				delete this.entries[key];
			}
		}

		return this.#commit(before);
	}

	/** Writes several days at once as one undo step. */
	set_many(changes: [key: string, entry: Entry | null][]) {
		const before = this.#snapshot();

		for (const [key, entry] of changes) {
			if (entry) {
				this.entries[key] = { ...entry };
			} else {
				delete this.entries[key];
			}
		}

		return this.#commit(before);
	}

	#commit(before: Entries) {
		const changed = changed_keys(before, this.#snapshot());
		if (changed.length === 0) return changed;

		this.#past.push(before);
		if (this.#past.length > HISTORY_LIMIT) this.#past.shift();
		this.#future = [];
		this.#persist();
		this.onchange?.(changed);

		return changed;
	}

	/** Returns the keys the undone change touched, so the UI can move to them. */
	undo() {
		const previous = this.#past.pop();
		if (!previous) return [];

		const current = this.#snapshot();
		this.#future.push(current);
		this.entries = previous;
		this.#persist();

		const changed = changed_keys(current, previous);
		this.onchange?.(changed);
		return changed;
	}

	redo() {
		const next = this.#future.pop();
		if (!next) return [];

		const current = this.#snapshot();
		this.#past.push(current);
		this.entries = next;
		this.#persist();

		const changed = changed_keys(current, next);
		this.onchange?.(changed);
		return changed;
	}

	/**
	 * Applies changes from the server. They are not undoable, and undo history is dropped when
	 * anything changed so undoing can't silently revert another device's edits.
	 */
	apply_remote(changes: [key: string, entry: Entry | null][]) {
		const before = this.#snapshot();

		for (const [key, entry] of changes) {
			if (entry) {
				this.entries[key] = { ...entry };
			} else {
				delete this.entries[key];
			}
		}

		const changed = changed_keys(before, this.#snapshot());
		if (changed.length) {
			this.#past = [];
			this.#future = [];
			this.#persist();
		}

		return changed;
	}

	/** Removes everything from this device, e.g. after signing out. */
	reset() {
		this.entries = {};
		this.settings = default_settings();
		save_settings(this.#storage, this.settings);
		this.#past = [];
		this.#future = [];
		this.#persist();
	}

	/** Picks up changes made in another tab. History is dropped so undo can't clobber them. */
	reload() {
		this.entries = load_entries(this.#storage);
		this.settings = load_settings(this.#storage);
		this.#past = [];
		this.#future = [];
		this.can_undo = false;
		this.can_redo = false;
	}
}
