import type { Entry } from './entries';
import type { Settings } from './settings';

export type Change = { date: string; entry: Entry | null };

export class ApiError extends Error {
	/** HTTP status, or 0 when the request never reached the server. */
	status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	let response: Response;
	try {
		response = await fetch(`/api${path}`, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			credentials: 'same-origin'
		});
	} catch {
		throw new ApiError(0, 'Can’t reach the server. Check your connection.');
	}

	const is_json = response.headers.get('content-type')?.includes('application/json');
	const data = is_json ? await response.json().catch(() => null) : null;

	if (!response.ok) {
		throw new ApiError(response.status, data?.error ?? `Request failed (${response.status})`);
	}
	if (response.status === 204) return undefined as T;
	// A static host without the API answers with HTML (or a 404 page).
	if (!is_json) throw new ApiError(404, 'Sync is not available on this server.');

	return data as T;
}

export const api = {
	pull: (since: number) =>
		request<{ rev: number; changes: Change[]; settings?: Settings }>(
			'GET',
			`/entries?since=${since}`
		),
	push: (changes: Change[], settings?: Settings) =>
		request<{ rev: number }>('PUT', '/entries', { changes, settings })
};
