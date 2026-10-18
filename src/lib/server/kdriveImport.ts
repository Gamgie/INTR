import { kdriveAccess } from '$lib/server/persistence';

export const IMPORTABLE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'];
const MAX_FILES = 3000;
const MAX_DEPTH = 6;

export type SourceFile = {
	id: number;
	name: string;
	/** Path relative to the source folder, e.g. "2024/Bulletins/janvier.pdf". */
	path: string;
	/** First-level subfolder ("" for files directly in the source folder). */
	group: string;
	/** Folder that currently holds the file. */
	parentId: number;
	size: number;
	importable: boolean;
};

/** Accepts a kDrive folder URL (…/files/122) or a bare id. */
export function parseFolderId(input: string) {
	const trimmed = input.trim();
	const fromUrl = /\/files\/(\d+)/.exec(trimmed)?.[1];
	const id = Number(fromUrl ?? (/^\d+$/.test(trimmed) ? trimmed : NaN));
	return Number.isInteger(id) && id > 0 ? id : 0;
}

export function isImportable(name: string) {
	const lower = name.toLowerCase();
	return IMPORTABLE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** Lists every file under a kDrive folder, skipping the app's own storage folder. */
export async function scanSourceFolder(folderId: number) {
	const access = kdriveAccess();
	if (!access) throw new Error('kDrive n’est pas configuré sur ce serveur.');

	const folder = await access.client.info(folderId);
	const files: SourceFile[] = [];
	const dirs: Array<{ id: number; path: string; parentId: number }> = [];
	const queue: Array<{ id: number; path: string; depth: number }> = [
		{ id: folderId, path: '', depth: 0 }
	];
	let truncated = false;

	while (queue.length) {
		const current = queue.shift()!;
		if (current.id === access.appFolderId) continue;
		for (const item of await access.client.list(current.id)) {
			const itemPath = current.path ? `${current.path}/${item.name}` : item.name;
			if (item.type === 'dir') {
				if (item.id === access.appFolderId) continue;
				dirs.push({ id: item.id, path: itemPath, parentId: current.id });
				if (current.depth + 1 < MAX_DEPTH) queue.push({ id: item.id, path: itemPath, depth: current.depth + 1 });
				else truncated = true;
				continue;
			}
			if (files.length >= MAX_FILES) {
				truncated = true;
				break;
			}
			files.push({
				id: item.id,
				name: item.name,
				path: itemPath,
				group: current.path ? current.path.split('/')[0] : '',
				parentId: current.id,
				size: item.size ?? 0,
				importable: isImportable(item.name)
			});
		}
	}

	files.sort((a, b) => a.path.localeCompare(b.path, 'fr', { numeric: true }));
	return { folder: { id: folderId, name: String(folder?.name ?? '') }, files, dirs, truncated };
}

export async function downloadSourceFile(fileId: number) {
	const access = kdriveAccess();
	if (!access) throw new Error('kDrive n’est pas configuré sur ce serveur.');
	const info = await access.client.info(fileId);
	const bytes = await access.client.download(fileId);
	return { name: String(info?.name ?? `kdrive-${fileId}`), bytes };
}
