import { KdriveError } from '$lib/server/kdriveClient.js';
import { kdriveAccess } from '$lib/server/persistence';
import { scanSourceFolder } from '$lib/server/kdriveImport';

// Folder ids by "<source id>/<path>", kept while the serverless instance stays warm.
const folderCache = new Map<string, number>();

function access() {
	const value = kdriveAccess();
	if (!value) throw new Error('kDrive n’est pas configuré sur ce serveur.');
	return value;
}

/** Finds or creates <source>/<dirs…> and returns the last folder's id. */
export async function ensurePath(sourceId: number, dirs: string[]) {
	const { client } = access();
	let parentId = sourceId;
	let path = String(sourceId);
	for (const name of dirs) {
		path = `${path}/${name}`;
		const cached = folderCache.get(path);
		if (cached) {
			parentId = cached;
			continue;
		}
		const folder = await client.ensureDirectory(parentId, name);
		if (!folder?.id) throw new Error(`Impossible de créer le dossier ${name}.`);
		parentId = Number(folder.id);
		folderCache.set(path, parentId);
	}
	return parentId;
}

/** Moves then renames one file; on a name clash, tries « nom 2 », « nom 3 »… */
export async function moveAndRename(fileId: number, destinationId: number, currentParentId: number, currentName: string, name: string) {
	const { client } = access();
	if (destinationId !== currentParentId) await client.move(fileId, destinationId);
	if (currentName === name) return name;

	const dot = name.lastIndexOf('.');
	const base = dot > 0 ? name.slice(0, dot) : name;
	const ext = dot > 0 ? name.slice(dot) : '';
	for (let attempt = 1; attempt <= 9; attempt += 1) {
		const candidate = attempt === 1 ? name : `${base} ${attempt}${ext}`;
		try {
			await client.rename(fileId, candidate);
			return candidate;
		} catch (cause) {
			const clash = cause instanceof KdriveError && (cause.status === 409 || /exist|conflict|already/i.test(`${cause.code} ${cause.description}`));
			if (!clash || attempt === 9) throw cause;
		}
	}
	return name;
}

/** Sends every folder that holds no file (directly or below) to the kDrive trash, deepest first. */
export async function trashEmptyFolders(sourceId: number) {
	const { client } = access();
	const scan = await scanSourceFolder(sourceId);
	const filePaths = scan.files.map((file) => file.path);
	const empty = scan.dirs
		.filter((dir) => !filePaths.some((path) => path.startsWith(`${dir.path}/`)))
		.sort((a, b) => b.path.split('/').length - a.path.split('/').length);
	const trashed: string[] = [];
	for (const dir of empty) {
		// A parent already sent to the trash takes its empty children with it.
		if (trashed.some((path) => dir.path.startsWith(`${path}/`))) continue;
		await client.trash(dir.id);
		trashed.push(dir.path);
	}
	for (const key of [...folderCache.keys()]) if (key.startsWith(`${sourceId}/`)) folderCache.delete(key);
	return trashed;
}

export function forgetFolders(sourceId: number) {
	for (const key of [...folderCache.keys()]) if (key.startsWith(`${sourceId}/`)) folderCache.delete(key);
}
