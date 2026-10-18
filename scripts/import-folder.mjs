#!/usr/bin/env node
// Importe en masse un dossier de documents dans une instance INTR (locale ou en ligne),
// par le même chemin que le bouton « Importer » : chaque fichier est analysé, classé
// (contrat, bulletin, AEM, notification ARE...) et rattaché au bon contrat.
//
// Usage :
//   ACCESS_PASSWORD=... node scripts/import-folder.mjs <dossier> [--url http://127.0.0.1:5173] [--report rapport.json]
//
// Les originaux ne sont jamais modifiés. Les fichiers déjà importés (même nom et même taille)
// sont ignorés quand on relance le script.

import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const option = (name, fallback) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : fallback;
};
const folder = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'));
const baseUrl = option('--url', 'http://127.0.0.1:5173').replace(/\/+$/, '');
const reportPath = option('--report', 'import-report.json');
const password = process.env.ACCESS_PASSWORD;

if (!folder || !password) {
	console.error('Usage : ACCESS_PASSWORD=... node scripts/import-folder.mjs <dossier> [--url ...]');
	process.exit(1);
}

const SUPPORTED = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
const CHUNK = 3.5 * 1024 * 1024;

async function walk(dir) {
	const files = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files.push(...(await walk(full)));
		else if (SUPPORTED.has(path.extname(entry.name).toLowerCase())) files.push(full);
	}
	return files;
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const files = (await walk(path.resolve(folder))).sort(collator.compare);

const loginBody = new URLSearchParams({ password });
const login = await fetch(`${baseUrl}/login`, {
	method: 'POST',
	body: loginBody,
	headers: { accept: 'application/json', origin: baseUrl, 'content-type': 'application/x-www-form-urlencoded' },
	redirect: 'manual'
});
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) {
	console.error(`Connexion impossible (${login.status}).`);
	process.exit(1);
}
const headers = { cookie, origin: baseUrl };

const existing = await (await fetch(`${baseUrl}/api/data`, { headers })).json();
const already = new Set(
	(existing.documents ?? []).map((document) => `${document.originalFileName}:${document.size}`)
);

const report = [];
let index = 0;
for (const file of files) {
	index += 1;
	const relative = path.relative(folder, file);
	const bytes = await readFile(file);
	const name = path.basename(file);
	const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : `image/${path.extname(name).slice(1).replace('jpg', 'jpeg')}`;

	if (already.has(`${name}:${bytes.length}`)) {
		report.push({ file: relative, status: 'déjà importé' });
		continue;
	}

	const body = new FormData();
	body.set('autoRoute', 'true');
	body.set('kind', 'Autre');
	if (bytes.length <= 4 * 1024 * 1024) {
		body.set('file', new File([bytes], name, { type }));
	} else {
		const id = `imp${Date.now().toString(36)}${index}`;
		const parts = Math.ceil(bytes.length / CHUNK);
		for (let part = 0; part < parts; part += 1) {
			await fetch(`${baseUrl}/api/uploads?id=${id}&part=${part}`, {
				method: 'POST',
				headers: { ...headers, 'content-type': 'application/octet-stream' },
				body: bytes.subarray(part * CHUNK, (part + 1) * CHUNK)
			});
		}
		body.set('fileStagingId', id);
		body.set('fileParts', String(parts));
		body.set('fileName', name);
		body.set('fileType', type);
	}

	const started = Date.now();
	try {
		const response = await fetch(`${baseUrl}/api/documents`, { method: 'POST', headers, body });
		const payload = await response.json().catch(() => ({}));
		const kinds = (payload.data?.documents ?? [])
			.filter((document) => payload.documentIds?.includes(document.id))
			.map((document) => document.kind);
		report.push({
			file: relative,
			status: response.ok ? 'importé' : 'erreur',
			message: response.ok ? undefined : payload.message,
			kinds,
			periods: payload.periodIds?.length || 0,
			fields: payload.appliedFields,
			notes: payload.analysis?.notes,
			seconds: Math.round((Date.now() - started) / 100) / 10
		});
		console.log(`[${index}/${files.length}] ${response.ok ? 'ok ' : 'ERR'} ${relative} ${kinds.join(', ')}`);
	} catch (cause) {
		report.push({ file: relative, status: 'erreur', message: String(cause) });
		console.log(`[${index}/${files.length}] ERR ${relative} ${cause}`);
	}
	await writeFile(reportPath, JSON.stringify(report, null, 2));
}

await writeFile(reportPath, JSON.stringify(report, null, 2));
const count = (status) => report.filter((item) => item.status === status).length;
console.log(`Terminé : ${count('importé')} importés, ${count('déjà importé')} déjà présents, ${count('erreur')} erreurs. Rapport : ${reportPath}`);
