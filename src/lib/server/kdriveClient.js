// Minimal client for the Infomaniak kDrive API (plain ESM so Node scripts can reuse it).
//
// Endpoints follow Infomaniak's own MCP server (github.com/Infomaniak/mcp-server-kdrive):
//   list      GET    https://api.infomaniak.com/3/drive/{drive}/files/{dir}/files
//   mkdir     POST   https://api.infomaniak.com/3/drive/{drive}/files/{dir}/directory
//   upload    POST   https://api.infomaniak.com/3/drive/{drive}/upload?directory_id&file_name&total_size
//   download  GET    https://api.infomaniak.com/2/drive/{drive}/files/{file}/download
//   trash     DELETE https://api.infomaniak.com/2/drive/{drive}/files/{file}
// Replacing an existing file's content uses `file_id` on upload (as kdrive-fuse does), which keeps
// kDrive's version history instead of creating a duplicate.

// KDRIVE_API_BASE only exists to point tests at a local fake kDrive.
const API = (globalThis.process?.env?.KDRIVE_API_BASE || 'https://api.infomaniak.com').replace(/\/+$/, '');

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class KdriveError extends Error {
	/**
	 * @param {string} message
	 * @param {number} status
	 * @param {{ operation?: string, code?: string, description?: string }} [details]
	 */
	constructor(message, status, details = {}) {
		super(message);
		this.status = status;
		this.operation = details.operation ?? '';
		this.code = details.code ?? '';
		this.description = details.description ?? '';
	}
}

/** Reads kDrive's error envelope { result: 'error', error: { code, description } }. */
function parseErrorBody(/** @type {string} */ text) {
	try {
		const payload = JSON.parse(text);
		return {
			code: String(payload?.error?.code ?? ''),
			description: String(payload?.error?.description ?? '')
		};
	} catch {
		return { code: '', description: text.slice(0, 200) };
	}
}

/**
 * A French explanation of a kDrive failure, safe to show on screen (never contains the token).
 * @param {unknown} cause
 */
export function explainKdriveError(cause) {
	if (!(cause instanceof KdriveError)) {
		return cause instanceof Error ? cause.message : String(cause);
	}
	const detail = [cause.code, cause.description].filter(Boolean).join(' : ');
	const where = cause.operation ? ` (${cause.operation})` : '';
	const hint =
		cause.status === 401
			? 'kDrive refuse le jeton : vérifie KDRIVE_TOKEN dans Vercel (jeton copié en entier, pas expiré, pas supprimé).'
			: cause.status === 403
				? 'Le jeton est accepté mais n’a pas les droits : il lui faut la portée « drive », et ton compte doit avoir accès à ce kDrive.'
				: cause.status === 404
					? 'kDrive ne trouve pas cet élément : vérifie KDRIVE_DRIVE_ID (le nombre après /drive/ dans l’adresse) et KDRIVE_FOLDER_ID (le nombre après /files/).'
					: cause.status === 429
						? 'kDrive limite le nombre de requêtes : réessaie dans une minute.'
						: `kDrive a répondu avec l’erreur ${cause.status}.`;
	return `${hint}${where}${detail ? ` Détail kDrive : ${detail}.` : ''}`;
}

export class KdriveClient {
	/** @param {{ token: string, driveId: string | number, fetch?: typeof fetch }} options */
	constructor({ token, driveId, fetch: fetcher }) {
		if (!token || !driveId) throw new Error('Jeton kDrive ou identifiant de kDrive manquant.');
		this.token = token;
		this.driveId = String(driveId);
		this.fetch = fetcher ?? globalThis.fetch.bind(globalThis);
	}

	/**
	 * @param {string} url
	 * @param {RequestInit} [init]
	 * @returns {Promise<Response>}
	 */
	async raw(url, init = {}) {
		let delay = 500;
		for (let attempt = 0; ; attempt += 1) {
			const response = await this.fetch(url, {
				...init,
				headers: { Authorization: `Bearer ${this.token}`, ...(init.headers ?? {}) }
			});
			const retryable = response.status === 429 || response.status >= 500;
			if (!retryable || attempt >= 4) {
				if (!response.ok) {
					const text = await response.text().catch(() => '');
					const operation = `${init.method ?? 'GET'} ${new URL(url).pathname}`;
					throw new KdriveError(
						`kDrive ${operation} : ${response.status} ${text.slice(0, 300)}`,
						response.status,
						{ operation, ...parseErrorBody(text) }
					);
				}
				return response;
			}
			const retryAfter = Number(response.headers.get('retry-after'));
			await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay);
			delay *= 2;
		}
	}

	/** @param {string} url @param {RequestInit} [init] */
	async json(url, init) {
		const response = await this.raw(url, init);
		const payload = await response.json();
		if (payload?.result && payload.result !== 'success') {
			throw new KdriveError(`kDrive : ${JSON.stringify(payload.error ?? payload).slice(0, 300)}`, 400, {
				operation: `${init?.method ?? 'GET'} ${new URL(url).pathname}`,
				code: String(payload?.error?.code ?? ''),
				description: String(payload?.error?.description ?? '')
			});
		}
		return payload;
	}

	/**
	 * All children of a directory (files and folders), following pagination.
	 * @param {number | string} directoryId
	 * @returns {Promise<Array<{ id: number, name: string, type: string, size?: number, last_modified_at?: number }>>}
	 */
	async list(directoryId) {
		const items = [];
		let cursor = '';
		for (let page = 0; page < 200; page += 1) {
			const params = new URLSearchParams({ limit: '1000' });
			if (cursor) params.set('cursor', cursor);
			const payload = await this.json(
				`${API}/3/drive/${this.driveId}/files/${directoryId}/files?${params}`
			);
			items.push(...(payload.data ?? []));
			if (!payload.has_more || !payload.cursor) break;
			cursor = payload.cursor;
		}
		return items;
	}

	/** The drive itself: checks the token and the drive id. */
	async drive() {
		return (await this.json(`${API}/2/drive/${this.driveId}`)).data;
	}

	/** @param {number | string} fileId */
	async info(fileId) {
		return (await this.json(`${API}/3/drive/${this.driveId}/files/${fileId}`)).data;
	}

	/** @param {number | string} parentId @param {string} name */
	async createDirectory(parentId, name) {
		return (
			await this.json(`${API}/3/drive/${this.driveId}/files/${parentId}/directory`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name })
			})
		).data;
	}

	/** Finds a child folder by name, creating it when missing. */
	async ensureDirectory(/** @type {number | string} */ parentId, /** @type {string} */ name) {
		const existing = (await this.list(parentId)).find(
			(item) => item.type === 'dir' && item.name === name
		);
		return existing ?? this.createDirectory(parentId, name);
	}

	/**
	 * Uploads a file. With `fileId`, replaces that file's content (kDrive keeps the old version).
	 * @param {{ directoryId?: number | string, name?: string, fileId?: number | string, data: Uint8Array }} input
	 */
	async upload({ directoryId, name, fileId, data }) {
		const params = new URLSearchParams({
			total_size: String(data.byteLength),
			last_modified_at: String(Math.floor(Date.now() / 1000))
		});
		if (fileId) {
			params.set('file_id', String(fileId));
		} else {
			params.set('directory_id', String(directoryId));
			params.set('file_name', String(name));
			params.set('conflict', 'version');
		}
		return (
			await this.json(`${API}/3/drive/${this.driveId}/upload?${params}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/octet-stream' },
				body: /** @type {BodyInit} */ (/** @type {unknown} */ (data))
			})
		).data;
	}

	/** @param {number | string} fileId @returns {Promise<Uint8Array>} */
	async download(fileId) {
		const response = await this.raw(`${API}/2/drive/${this.driveId}/files/${fileId}/download`);
		return new Uint8Array(await response.arrayBuffer());
	}

	/** Moves a file to the kDrive trash (recoverable). @param {number | string} fileId */
	async trash(fileId) {
		await this.json(`${API}/2/drive/${this.driveId}/files/${fileId}`, { method: 'DELETE' });
	}
}
