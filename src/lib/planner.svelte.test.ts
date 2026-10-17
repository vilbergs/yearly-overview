import { describe, expect, it } from 'vitest';
import { STORAGE_KEY } from './entries';
import { Planner } from './planner.svelte';

function memory_storage() {
	const store = new Map<string, string>();
	return {
		store,
		storage: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value)
		} as Storage
	};
}

describe('Planner', () => {
	it('persists changes and supports undo/redo', () => {
		const { store, storage } = memory_storage();
		const planner = new Planner(storage);

		expect(planner.set(['2026-01-01', '2026-01-02'], { title: 'Trip', description: '' })).toEqual([
			'2026-01-01',
			'2026-01-02'
		]);
		expect(JSON.parse(store.get(STORAGE_KEY)!)).toHaveProperty('2026-01-02');

		planner.set(['2026-01-02'], null);
		expect(planner.entries['2026-01-02']).toBeUndefined();

		expect(planner.undo()).toEqual(['2026-01-02']);
		expect(planner.entries['2026-01-02']?.title).toBe('Trip');
		expect(planner.can_redo).toBe(true);

		expect(planner.redo()).toEqual(['2026-01-02']);
		expect(planner.entries['2026-01-02']).toBeUndefined();
		expect(JSON.parse(store.get(STORAGE_KEY)!)).not.toHaveProperty('2026-01-02');
	});

	it('does not record no-op changes', () => {
		const planner = new Planner(memory_storage().storage);
		expect(planner.set(['2026-01-01'], null)).toEqual([]);
		expect(planner.can_undo).toBe(false);
	});

	it('flags storage failures', () => {
		expect(new Planner(undefined).save_failed).toBe(true);
	});
});
