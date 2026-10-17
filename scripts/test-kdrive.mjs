// End-to-end test of the Vercel bundle against a fake kDrive.
// Builds with VERCEL=1, then drives the serverless handler directly (no network).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

import { startFakeKdrive } from './test-support/fake-kdrive.mjs';

if (!process.argv.includes('--skip-build')) {
	const build = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
		env: { ...process.env, VERCEL: '1' },
		stdio: 'inherit'
	});
	assert.equal(build.status, 0, 'build Vercel');
	const include = spawnSync(process.execPath, ['scripts/vercel-include-dynamic.mjs'], { stdio: 'inherit' });
	assert.equal(include.status, 0, 'copie des fichiers dynamiques');
}

// Copy the function out of the project so it cannot fall back on the project's node_modules.
const workDir = await mkdtemp(path.join(tmpdir(), 'intermittens-kdrive-'));
const functionDir = path.join(workDir, 'func');
await cp('.vercel/output/functions/![-]/catchall.func', functionDir, {
	recursive: true,
	dereference: true
});

const kdrive = await startFakeKdrive();
process.env.ACCESS_PASSWORD = 'mot-de-passe-test';
process.env.KDRIVE_TOKEN = kdrive.token;
process.env.KDRIVE_DRIVE_ID = kdrive.driveId;
process.env.KDRIVE_FOLDER_ID = String(kdrive.appFolderId);
process.env.KDRIVE_API_BASE = `http://127.0.0.1:${kdrive.port}`;

const handler = (
	await import(pathToFileURL(path.join(functionDir, '.svelte-kit/vercel-tmp/index.js')).href)
).default;
const origin = 'https://intermittent.gamgie.com';
let cookie = '';
const call = (route, init = {}) =>
	handler.fetch(
		new Request(origin + route, {
			...init,
			headers: { origin, 'x-forwarded-for': '1.2.3.4', cookie, ...(init.headers ?? {}) }
		})
	);

async function scannedContractPdf(title, padBytes = 0, month = 3) {
	const mm = String(month).padStart(2, '0');
	const canvas = createCanvas(1400, 1800);
	const context = canvas.getContext('2d');
	context.fillStyle = '#fff';
	context.fillRect(0, 0, 1400, 1800);
	context.fillStyle = '#111';
	context.font = 'bold 42px Arial';
	context.fillText("CONTRAT D'ENGAGEMENT A DUREE DETERMINEE DIT D'USAGE", 80, 120);
	context.font = '30px Arial';
	[`Employeur : ${title}`, 'Emploi : Regisseur video', `Du 03/${mm}/2026 au 07/${mm}/2026`, 'Nombre d heures : 40', 'Salaire brut : 800,00 EUR'].forEach(
		(line, index) => context.fillText(line, 80, 240 + index * 70)
	);
	const pdf = await PDFDocument.create();
	const image = await pdf.embedPng(canvas.toBuffer('image/png'));
	const page = pdf.addPage([595, 765]);
	page.drawImage(image, { x: 0, y: 0, width: 595, height: 765 });
	if (padBytes) {
		// Incompressible padding as an attachment, to exceed Vercel's 4.5 MB body limit.
		const noise = new Uint8Array(padBytes);
		for (let i = 0; i < noise.length; i += 65536) crypto.getRandomValues(noise.subarray(i, i + 65536));
		await pdf.attach(noise, 'padding.bin', { mimeType: 'application/octet-stream' });
	}
	return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

async function importFile(name, bytes) {
	const body = new FormData();
	body.set('autoRoute', 'true');
	body.set('kind', 'Autre');
	const limit = 4 * 1024 * 1024;
	if (bytes.length <= limit) {
		body.set('file', new File([bytes], name, { type: 'application/pdf' }));
	} else {
		const chunk = 3.5 * 1024 * 1024;
		const id = 'test' + Date.now().toString(36);
		const parts = Math.ceil(bytes.length / chunk);
		for (let part = 0; part < parts; part += 1) {
			const response = await call(`/api/uploads?id=${id}&part=${part}`, {
				method: 'POST',
				body: bytes.slice(part * chunk, (part + 1) * chunk),
				headers: { 'content-type': 'application/octet-stream' }
			});
			assert.equal(response.status, 200, `fragment ${part}`);
		}
		body.set('fileStagingId', id);
		body.set('fileParts', String(parts));
		body.set('fileName', name);
		body.set('fileType', 'application/pdf');
	}
	const response = await call('/api/documents', { method: 'POST', body });
	const payload = await response.json();
	assert.equal(response.status, 200, `import ${name}: ${payload.message}`);
	return payload;
}

try {
	assert.equal((await call('/api/data')).status, 401, 'données protégées sans session');

	const login = new FormData();
	login.set('password', 'mot-de-passe-test');
	const loginResponse = await call('/login', {
		method: 'POST',
		body: login,
		headers: { accept: 'application/json' }
	});
	cookie = loginResponse.headers.get('set-cookie')?.split(';')[0] ?? '';
	assert.ok(cookie, 'cookie de session');

	const initial = await (await call('/api/data')).json();
	assert.equal(initial.version, 1);
	const appFiles = kdrive.children(kdrive.appFolderId).map((node) => node.name);
	assert.ok(appFiles.includes('intermittens.json'), 'base créée dans le dossier kDrive');

	const scan = await importFile('scan-contrat.pdf', await scannedContractPdf('Compagnie Scan'));
	assert.match(scan.analysis.notes.join(' '), /OCR française appliquée/);
	assert.equal(scan.appliedFields.hours, 40);
	assert.equal(scan.appliedFields.grossSalary, 800);

	const bigBytes = await scannedContractPdf('Compagnie Lourde', 9 * 1024 * 1024, 4);
	assert.ok(bigBytes.length > 9 * 1024 * 1024, 'fichier de plus de 9 Mo');
	const big = await importFile('gros-scan.pdf', bigBytes);
	assert.equal(big.appliedFields.hours, 40, 'gros fichier analysé: ' + JSON.stringify({ f: big.appliedFields, n: big.analysis?.notes, m: big.message }));
	const documentsFolder = kdrive.children(kdrive.appFolderId).find((node) => node.name === 'documents');
	assert.ok(documentsFolder, 'sous-dossier documents');
	assert.ok(
		!kdrive.children(documentsFolder.id).some((node) => node.name.startsWith('staging-')),
		'fragments temporaires retirés'
	);

	for (let index = 0; index < 11; index += 1) {
		await importFile(`contrat-${index}.pdf`, await scannedContractPdf(`Compagnie ${index}`, 0, ((index + 4) % 12) + 1));
	}

	const data = await (await call('/api/data')).json();
	assert.equal(data.documents.length, 13, '13 documents en base');
	assert.ok(kdrive.children(documentsFolder.id).length >= 13, 'plus d’une page de liste kDrive');

	// Every stored document can be read back (exercises paginated name -> id lookup).
	for (const document of data.documents) {
		const response = await call(`/api/documents/${document.id}`);
		assert.equal(response.status, 200, `lecture ${document.fileName}`);
		const bytes = new Uint8Array(await response.arrayBuffer());
		assert.equal(bytes.length, document.size, `taille ${document.fileName}`);
	}

	const toDelete = data.documents.at(-1);
	const deleteResponse = await call(`/api/documents/${toDelete.id}`, { method: 'DELETE' });
	assert.equal(deleteResponse.status, 200);
	assert.ok(kdrive.trash.some((node) => node.name === toDelete.storedName), 'fichier mis à la corbeille');

	const dataNode = kdrive.children(kdrive.appFolderId).find((node) => node.name === 'intermittens.json');
	assert.ok((dataNode.versions?.length ?? 0) > 5, 'versions successives de la base conservées');
	assert.equal(
		kdrive.children(kdrive.appFolderId).filter((node) => node.name === 'intermittens.json').length,
		1,
		'une seule base, pas de doublon'
	);

	console.log(
		`kDrive storage tests passed (${kdrive.stats.uploads} envois, ${kdrive.stats.downloads} lectures, ${kdrive.stats.lists} listes).`
	);
} finally {
	kdrive.server.close();
	await rm(workDir, { recursive: true, force: true });
}
