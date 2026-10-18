// Persistence backends for INTR.
//
// - Local filesystem (original behaviour): data/intr.json + data/documents/
// - kDrive (hosted deployment on Vercel): the same layout inside one kDrive folder
//     <KDRIVE_FOLDER_ID>/intr.json
//     <KDRIVE_FOLDER_ID>/documents/<stored files>
//
// kDrive is selected automatically when KDRIVE_TOKEN, KDRIVE_DRIVE_ID and KDRIVE_FOLDER_ID are set.
// The token stays on the server; the browser never talks to kDrive directly.
// Deleted files go to the kDrive trash, and replacing intr.json keeps kDrive's versions.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '$env/dynamic/private';

import { KdriveClient, KdriveError } from '$lib/server/kdriveClient.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const dataDir = path.join(root, 'data');
export const documentDir = path.join(dataDir, 'documents');
const dataFile = path.join(dataDir, 'intr.json');
const documentDirResolved = path.resolve(documentDir);

export const DATA_FILE_NAME = 'intr.json';
export const DOCUMENTS_FOLDER_NAME = 'documents';

export interface PersistenceBackend {
	name: 'local' | 'kdrive';
	readJson(): Promise<unknown | null>;
	writeJson(data: unknown): Promise<void>;
	putFile(storedName: string, buffer: Buffer): Promise<void>;
	getFile(storedName: string): Promise<Buffer>;
	deleteFiles(storedNames: string[]): Promise<string[]>;
	listFiles(): Promise<string[]>;
}

export function assertSafeStoredName(storedName: string) {
	if (
		!storedName ||
		storedName.length > 255 ||
		storedName.includes('/') ||
		storedName.includes('\\') ||
		storedName.startsWith('.')
	) {
		throw new Error(`Nom de document invalide: ${storedName}`);
	}
	return storedName;
}

function resolveLocalPath(storedName: string) {
	const target = path.resolve(documentDir, assertSafeStoredName(storedName));
	if (!target.startsWith(`${documentDirResolved}${path.sep}`)) {
		throw new Error(`Chemin document invalide: ${storedName}`);
	}
	return target;
}

const localBackend: PersistenceBackend = {
	name: 'local',
	async readJson() {
		try {
			return JSON.parse(await readFile(dataFile, 'utf-8'));
		} catch (cause) {
			if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return null;
			throw cause;
		}
	},
	async writeJson(data) {
		await mkdir(dataDir, { recursive: true });
		const tmpFile = `${dataFile}.tmp`;
		await writeFile(tmpFile, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
		await rename(tmpFile, dataFile);
	},
	async putFile(storedName, buffer) {
		await mkdir(documentDir, { recursive: true });
		await writeFile(resolveLocalPath(storedName), buffer);
	},
	async getFile(storedName) {
		return readFile(resolveLocalPath(storedName));
	},
	async deleteFiles(storedNames) {
		const deleted: string[] = [];
		for (const storedName of storedNames) {
			try {
				await unlink(resolveLocalPath(storedName));
				deleted.push(storedName);
			} catch (cause) {
				if (!(cause instanceof Error) || !('code' in cause) || cause.code !== 'ENOENT') throw cause;
			}
		}
		return deleted;
	},
	async listFiles() {
		await mkdir(documentDir, { recursive: true });
		return readdir(documentDir);
	}
};

// --- kDrive -------------------------------------------------------------------------------

type KdriveState = {
	client: KdriveClient;
	folderId: string;
	documentsFolderId?: number;
	dataFileId?: number;
	documentIds?: Map<string, number>;
};

let kdriveState: KdriveState | null = null;

function kdrive(): KdriveState {
	if (!kdriveState) {
		kdriveState = {
			client: new KdriveClient({ token: env.KDRIVE_TOKEN!, driveId: env.KDRIVE_DRIVE_ID! }),
			folderId: env.KDRIVE_FOLDER_ID!.trim()
		};
	}
	return kdriveState;
}

async function documentsFolderId(state: KdriveState) {
	if (!state.documentsFolderId) {
		const folder = await state.client.ensureDirectory(state.folderId, DOCUMENTS_FOLDER_NAME);
		if (!folder?.id) throw new Error('Dossier documents introuvable dans kDrive.');
		state.documentsFolderId = Number(folder.id);
	}
	return state.documentsFolderId;
}

// Name -> file id for the documents folder. Rebuilt from a listing when a name is unknown,
// so files added by another instance (or by hand in kDrive) are found too.
async function documentIds(state: KdriveState, refresh = false) {
	if (!state.documentIds || refresh) {
		const items = await state.client.list(await documentsFolderId(state));
		state.documentIds = new Map(
			items.filter((item) => item.type === 'file').map((item) => [item.name, item.id])
		);
	}
	return state.documentIds;
}

async function documentId(state: KdriveState, storedName: string) {
	return (
		(await documentIds(state)).get(storedName) ?? (await documentIds(state, true)).get(storedName)
	);
}

async function dataFileId(state: KdriveState, refresh = false) {
	if (!state.dataFileId || refresh) {
		const items = await state.client.list(state.folderId);
		state.dataFileId = items.find((item) => item.type === 'file' && item.name === DATA_FILE_NAME)?.id;
	}
	return state.dataFileId;
}

const kdriveBackend: PersistenceBackend = {
	name: 'kdrive',
	async readJson() {
		const state = kdrive();
		// Always re-list: another serverless instance may have written a newer version.
		const id = await dataFileId(state, true);
		if (!id) return null;
		const bytes = await state.client.download(id);
		return JSON.parse(Buffer.from(bytes).toString('utf-8'));
	},
	async writeJson(data) {
		const state = kdrive();
		const bytes = new TextEncoder().encode(`${JSON.stringify(data, null, 2)}\n`);
		const id = await dataFileId(state);
		try {
			const file = id
				? await state.client.upload({ fileId: id, data: bytes })
				: await state.client.upload({
						directoryId: state.folderId,
						name: DATA_FILE_NAME,
						data: bytes
					});
			if (file?.id) state.dataFileId = file.id;
		} catch (cause) {
			// The cached id may point to a file that was moved or deleted: retry by name once.
			if (!(cause instanceof KdriveError) || !id) throw cause;
			state.dataFileId = undefined;
			const file = await state.client.upload({
				directoryId: state.folderId,
				name: DATA_FILE_NAME,
				data: bytes
			});
			if (file?.id) state.dataFileId = file.id;
		}
	},
	async putFile(storedName, buffer) {
		const state = kdrive();
		const name = assertSafeStoredName(storedName);
		const file = await state.client.upload({
			directoryId: await documentsFolderId(state),
			name,
			data: new Uint8Array(buffer)
		});
		if (file?.id) (await documentIds(state)).set(name, file.id);
	},
	async getFile(storedName) {
		const state = kdrive();
		const id = await documentId(state, assertSafeStoredName(storedName));
		if (!id) throw new Error(`Document introuvable dans kDrive: ${storedName}`);
		return Buffer.from(await state.client.download(id));
	},
	async deleteFiles(storedNames) {
		const state = kdrive();
		const deleted: string[] = [];
		for (const storedName of storedNames) {
			const id = await documentId(state, assertSafeStoredName(storedName));
			if (!id) continue;
			await state.client.trash(id);
			state.documentIds?.delete(storedName);
			deleted.push(storedName);
		}
		return deleted;
	},
	async listFiles() {
		return [...(await documentIds(kdrive(), true)).keys()];
	}
};

/** kDrive client and the app's own folder, for reading original documents elsewhere in the drive. */
export function kdriveAccess() {
	if (!kdriveConfigured()) return null;
	const state = kdrive();
	return { client: state.client, appFolderId: Number(state.folderId) };
}

export function kdriveConfigured() {
	return Boolean(
		env.KDRIVE_TOKEN?.trim() && env.KDRIVE_DRIVE_ID?.trim() && env.KDRIVE_FOLDER_ID?.trim()
	);
}

export function persistence(): PersistenceBackend {
	return kdriveConfigured() ? kdriveBackend : localBackend;
}

// --- Large uploads ------------------------------------------------------------------------
// Vercel refuses request bodies over 4.5 MB. Bigger files arrive in chunks, each stored as a
// temporary "staging-…" file, then reassembled by the request that imports the document.

export const STAGING_PREFIX = 'staging-';
const STAGING_NAME = /^staging-[a-z0-9]{6,32}\.part\d{1,3}$/;

export function stagingPartName(stagingId: string, part: number) {
	return `${STAGING_PREFIX}${stagingId}.part${part}`;
}

export async function putStagingPart(stagingId: string, part: number, buffer: Buffer) {
	const name = stagingPartName(stagingId, part);
	if (!STAGING_NAME.test(name)) throw new Error('Fragment de fichier invalide.');
	await persistence().putFile(name, buffer);
}

export async function takeStagedFile(stagingId: string, parts: number) {
	if (!Number.isInteger(parts) || parts < 1 || parts > 100) throw new Error('Fichier fragmenté invalide.');
	const names = Array.from({ length: parts }, (_, index) => stagingPartName(stagingId, index));
	if (!names.every((name) => STAGING_NAME.test(name))) throw new Error('Fichier fragmenté invalide.');
	const buffers: Buffer[] = [];
	for (const name of names) buffers.push(await persistence().getFile(name));
	await persistence().deleteFiles(names);
	return Buffer.concat(buffers);
}
