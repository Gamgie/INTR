// Persistence backends for InterMittens.
//
// - Local filesystem (original behaviour): data/intermittens.json + data/documents/
// - Supabase (hosted deployment, e.g. Vercel): one JSON row in Postgres + a private Storage bucket
//
// The Supabase backend is selected automatically when SUPABASE_URL and SUPABASE_SECRET_KEY are set.
// The secret key stays on the server; the browser never talks to Supabase directly.

import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '$env/dynamic/private';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const dataDir = path.join(root, 'data');
export const documentDir = path.join(dataDir, 'documents');
const dataFile = path.join(dataDir, 'intermittens.json');
const documentDirResolved = path.resolve(documentDir);

const TABLE = 'intermittens_data';
const ROW_ID = 'main';

export interface PersistenceBackend {
	name: 'local' | 'supabase';
	readJson(): Promise<unknown | null>;
	writeJson(data: unknown): Promise<void>;
	putFile(storedName: string, buffer: Buffer, contentType?: string): Promise<void>;
	getFile(storedName: string): Promise<Buffer>;
	deleteFiles(storedNames: string[]): Promise<string[]>;
	listFiles(): Promise<string[]>;
}

function assertSafeStoredName(storedName: string) {
	if (!storedName || storedName.includes('/') || storedName.includes('\\') || storedName.startsWith('.')) {
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

let supabaseClient: SupabaseClient | null = null;

function supabase() {
	if (!supabaseClient) {
		supabaseClient = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!, {
			auth: { persistSession: false, autoRefreshToken: false }
		});
	}
	return supabaseClient;
}

function bucket() {
	return env.SUPABASE_BUCKET?.trim() || 'documents';
}

const supabaseBackend: PersistenceBackend = {
	name: 'supabase',
	async readJson() {
		const { data, error } = await supabase()
			.from(TABLE)
			.select('data')
			.eq('id', ROW_ID)
			.maybeSingle();
		if (error) throw new Error(`Lecture Supabase impossible: ${error.message}`);
		return data?.data ?? null;
	},
	async writeJson(payload) {
		const { error } = await supabase()
			.from(TABLE)
			.upsert({ id: ROW_ID, data: payload, updated_at: new Date().toISOString() });
		if (error) throw new Error(`Écriture Supabase impossible: ${error.message}`);
	},
	async putFile(storedName, buffer, contentType) {
		const { error } = await supabase()
			.storage.from(bucket())
			.upload(assertSafeStoredName(storedName), buffer, {
				contentType: contentType || 'application/octet-stream',
				upsert: true
			});
		if (error) throw new Error(`Envoi du document impossible: ${error.message}`);
	},
	async getFile(storedName) {
		const { data, error } = await supabase()
			.storage.from(bucket())
			.download(assertSafeStoredName(storedName));
		if (error || !data) throw new Error(`Document introuvable: ${storedName}`);
		return Buffer.from(await data.arrayBuffer());
	},
	async deleteFiles(storedNames) {
		if (!storedNames.length) return [];
		const { data, error } = await supabase()
			.storage.from(bucket())
			.remove(storedNames.map(assertSafeStoredName));
		if (error) throw new Error(`Suppression impossible: ${error.message}`);
		return (data ?? []).map((item) => item.name);
	},
	async listFiles() {
		const names: string[] = [];
		const pageSize = 1000;
		for (let offset = 0; ; offset += pageSize) {
			const { data, error } = await supabase()
				.storage.from(bucket())
				.list('', { limit: pageSize, offset, sortBy: { column: 'name', order: 'asc' } });
			if (error) throw new Error(`Liste des documents impossible: ${error.message}`);
			names.push(...(data ?? []).map((item) => item.name).filter((name) => !name.startsWith('.')));
			if (!data || data.length < pageSize) break;
		}
		return names;
	}
};

export function persistence(): PersistenceBackend {
	return env.SUPABASE_URL?.trim() && env.SUPABASE_SECRET_KEY?.trim() ? supabaseBackend : localBackend;
}

// Large uploads (> Vercel's 4.5 MB request limit) go straight from the browser to Storage
// through a one-time signed URL, under a "staging-" name, then the server takes them back.
export const STAGING_PREFIX = 'staging-';

export async function createStagingUpload(fileName: string) {
	if (persistence().name !== 'supabase') return null;
	const safe = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80) || 'document';
	const stagedName = `${STAGING_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}-${safe}`;
	const { data, error } = await supabase().storage.from(bucket()).createSignedUploadUrl(stagedName);
	if (error || !data) throw new Error(`Préparation de l'envoi impossible: ${error?.message ?? ''}`);
	return { stagedName, signedUrl: data.signedUrl };
}

export async function takeStagedFile(stagedName: string) {
	if (!stagedName.startsWith(STAGING_PREFIX)) throw new Error('Fichier temporaire invalide.');
	const buffer = await supabaseBackend.getFile(stagedName);
	await supabaseBackend.deleteFiles([stagedName]);
	return buffer;
}
