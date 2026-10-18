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
const workDir = await mkdtemp(path.join(tmpdir(), 'intr-kdrive-'));
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
const origin = 'https://intr.gamgie.com';
let cookie = '';
const call = (route, init = {}) =>
	handler.fetch(
		new Request(origin + route, {
			...init,
			headers: { origin, 'x-forwarded-for': '1.2.3.4', cookie, ...(init.headers ?? {}) }
		})
	);

async function scannedContractPdf(title, padBytes = 0, month = 3, startDay = 3) {
	const mm = String(month).padStart(2, '0');
	const d1 = String(startDay).padStart(2, '0');
	const d2 = String(startDay + 4).padStart(2, '0');
	const canvas = createCanvas(1400, 1800);
	const context = canvas.getContext('2d');
	context.fillStyle = '#fff';
	context.fillRect(0, 0, 1400, 1800);
	context.fillStyle = '#111';
	context.font = 'bold 42px Arial';
	context.fillText("CONTRAT D'ENGAGEMENT A DUREE DETERMINEE DIT D'USAGE", 80, 120);
	context.font = '30px Arial';
	[`Entre les soussignés ${title}, Siret : 444 555 668 00011`, 'Emploi : Regisseur video', `Du ${d1}/${mm}/2026 au ${d2}/${mm}/2026`, 'Nombre d heures : 40', 'Salaire brut : 800,00 EUR'].forEach(
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
	assert.ok(appFiles.includes('intr.json'), 'base créée dans le dossier kDrive');

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

	const dataNode = kdrive.children(kdrive.appFolderId).find((node) => node.name === 'intr.json');
	assert.ok((dataNode.versions?.length ?? 0) > 5, 'versions successives de la base conservées');
	assert.equal(
		kdrive.children(kdrive.appFolderId).filter((node) => node.name === 'intr.json').length,
		1,
		'une seule base, pas de doublon'
	);

	// --- Import from a kDrive source folder shaped like Clément's « Intermittence » ---
	const source = kdrive.addDir(1, 'Intermittence');
	const y2025 = kdrive.addDir(source.id, '2025');
	const archive = kdrive.addDir(source.id, 'Archive');
	kdrive.addFile(y2025.id, 'contrat-octobre.pdf', await scannedContractPdf('Compagnie Source', 0, 10, 20));
	kdrive.addFile(y2025.id, 'contrat-novembre.pdf', await scannedContractPdf('Compagnie Source', 0, 11, 20));
	kdrive.addFile(archive.id, 'vieux.pdf', await scannedContractPdf('Compagnie Archive', 0, 12));
	kdrive.addFile(source.id, 'Déclaration.xlsx', 'pas un pdf');
	// The app's own folder stored inside the source must never be re-imported.
	kdrive.move(kdrive.appFolderId, source.id);

	const sourceUrl = `https://ksuite.infomaniak.com/2216131/kdrive/app/drive/${kdrive.driveId}/files/${source.id}`;
	const scanResponse = await call(`/api/kdrive/source?folder=${encodeURIComponent(sourceUrl)}`);
	const scanned = await scanResponse.json();
	assert.equal(scanResponse.status, 200, `lecture du dossier source: ${scanned.message}`);
	assert.equal(scanned.folder.name, 'Intermittence');
	assert.deepEqual(
		scanned.files.map((file) => [file.path, file.importable]),
		[
			['2025/contrat-novembre.pdf', true],
			['2025/contrat-octobre.pdf', true],
			['Archive/vieux.pdf', true],
			['Déclaration.xlsx', false]
		],
		'arborescence lue, dossier de l’app ignoré'
	);

	const before = (await (await call('/api/data')).json()).contracts.length;
	for (const file of scanned.files.filter((item) => item.group === '2025')) {
		const response = await call('/api/kdrive/import', {
			method: 'POST',
			body: JSON.stringify({ fileId: file.id, path: file.path }),
			headers: { 'content-type': 'application/json' }
		});
		const payload = await response.json();
		assert.equal(response.status, 200, `import kDrive ${file.path}: ${payload.record?.message}`);
		assert.equal(payload.record.status, 'importé');
		assert.equal(payload.data.kdriveImports.find((item) => item.fileId === file.id)?.status, 'importé');
	}
	const after = await (await call('/api/data')).json();
	assert.equal(after.contracts.length, before + 2, 'deux contrats créés depuis kDrive');
	assert.ok(
		after.contracts.some((contract) => contract.startDate === '2026-10-20' && contract.hours === 40),
		'contrat d’octobre analysé'
	);

	const rescan = await (await call(`/api/kdrive/source?folder=${source.id}`)).json();
	assert.deepEqual(
		rescan.files.filter((file) => file.status === 'importé').map((file) => file.path),
		['2025/contrat-novembre.pdf', '2025/contrat-octobre.pdf'],
		'statut d’import conservé pour la relance'
	);
	assert.ok(
		kdrive.nodes.get(scanned.files[0].id).data.length > 0 && !kdrive.trash.some((node) => node.parent_id === y2025.id),
		'originaux intacts'
	);

	// --- Organize the source folder, undo, then empty folders ---
	{
		const sourceFolder = `${source.id}`;
		const intoTree = (id) => kdrive.pathOf(id).replace(/^Intermittence\//, '');
		const loose = kdrive.addFile(archive.id, '[AEM] 2024-11-09 Baron Production.pdf', 'aem');
		const clash = kdrive.addDir(source.id, 'Archive2');
		const planResponse = await call(`/api/kdrive/organize?folder=${sourceFolder}`);
		const plan = await planResponse.json();
		assert.equal(planResponse.status, 200, `plan: ${plan.message}`);
		const targets = Object.fromEntries(plan.moves.map((move) => [move.fromPath, move.toPath]));
		assert.ok(targets['2025/contrat-octobre.pdf'], 'contrat d’octobre à ranger');
		assert.ok(!targets['Archive/[AEM] 2024-11-09 Baron Production.pdf'], 'non importé : laissé en place');
		assert.match(
			plan.skipped.find((skip) => skip.path === 'Archive/[AEM] 2024-11-09 Baron Production.pdf')?.reason ?? '',
			/pas encore importé/
		);
		assert.match(targets['2025/contrat-octobre.pdf'], /\/Compagnie Source\/\[CT\] 2026-10-20 Compagnie Source\.pdf$/, 'employeur lu par OCR');
		assert.ok(plan.skipped.some((skip) => skip.path === 'Déclaration.xlsx'), 'tableur laissé');

		const before = plan.moves.map((move) => [move.fileId, intoTree(move.fileId)]);
		const batchId = 'lot-test';
		for (const move of plan.moves) {
			const response = await call('/api/kdrive/organize/apply', {
				method: 'POST',
				body: JSON.stringify({ folderId: source.id, batchId, move }),
				headers: { 'content-type': 'application/json' }
			});
			const payload = await response.json();
			assert.equal(response.status, 200, `rangement ${move.fromPath}: ${payload.message}`);
			assert.equal(intoTree(move.fileId), move.toPath, `chemin réel de ${move.fromPath}`);
		}
		const replan = await (await call(`/api/kdrive/organize?folder=${sourceFolder}`)).json();
		assert.equal(replan.moves.length, 0, 'plus rien à ranger');
		const data = await (await call('/api/data')).json();
		assert.equal(data.kdriveMoves.filter((move) => move.batchId === batchId).length, plan.moves.length, 'journal complet');

		for (const move of [...plan.moves].reverse()) {
			const response = await call('/api/kdrive/organize/undo', {
				method: 'POST',
				body: JSON.stringify({ batchId, fileId: move.fileId }),
				headers: { 'content-type': 'application/json' }
			});
			assert.equal(response.status, 200, `annulation ${move.toPath}`);
		}
		assert.deepEqual(plan.moves.map((move) => [move.fileId, intoTree(move.fileId)]), before, 'tout est revenu en place');

		// Rangement à nouveau, puis nettoyage des dossiers vides (vers la corbeille).
		const plan2 = await (await call(`/api/kdrive/organize?folder=${sourceFolder}`)).json();
		for (const move of plan2.moves) {
			await call('/api/kdrive/organize/apply', {
				method: 'POST',
				body: JSON.stringify({ folderId: source.id, batchId: 'lot-2', move }),
				headers: { 'content-type': 'application/json' }
			});
		}
		const emptied = await (await call('/api/kdrive/organize/empty', {
			method: 'POST',
			body: JSON.stringify({ folder: sourceFolder }),
			headers: { 'content-type': 'application/json' }
		})).json();
		assert.ok(emptied.ok, emptied.message);
		assert.ok(emptied.trashed.includes('2025') && emptied.trashed.includes('Archive2'), `dossiers vides: ${emptied.trashed}`);
		assert.ok(!emptied.trashed.includes('Archive'), 'Archive garde ses fichiers');
		assert.ok(kdrive.nodes.has(loose.id) && kdrive.nodes.has(clash.id) === false, 'fichiers intacts, dossier vide à la corbeille');
	}

	// --- Deep tree and pagination (fake kDrive pages by 10) ---
	const deep = kdrive.addDir(1, 'Profond');
	const level1 = kdrive.addDir(deep.id, '2024');
	const level2 = kdrive.addDir(level1.id, 'Bulletins');
	const level3 = kdrive.addDir(level2.id, 'Mars');
	for (let index = 0; index < 23; index += 1) kdrive.addFile(level2.id, `bulletin-${index}.pdf`, 'x');
	for (let index = 0; index < 12; index += 1) kdrive.addFile(level3.id, `cachet-${index}.PDF`, 'x');
	kdrive.addFile(level1.id, 'aem.pdf', 'x');
	const deepScan = await (await call(`/api/kdrive/source?folder=${deep.id}`)).json();
	assert.equal(deepScan.files.length, 36, `arborescence profonde lue en entier (${deepScan.files.length})`);
	assert.ok(deepScan.files.some((file) => file.path === '2024/Bulletins/Mars/cachet-11.PDF' && file.importable));
	assert.ok(deepScan.files.every((file) => file.group === '2024'));

	// --- Diagnostic and readable errors ---
	const diagnostic = await call('/diagnostic');
	const diagnosticHtml = await diagnostic.text();
	assert.equal(diagnostic.status, 200);
	assert.match(diagnosticHtml, /Tout fonctionne/, 'diagnostic au vert');
	assert.match(diagnosticHtml, /kDrive test/);
	assert.ok(!diagnosticHtml.includes(kdrive.token), 'le jeton n’apparaît jamais');

	kdrive.setToken('autre-jeton');
	const broken = await call('/');
	const brokenHtml = await broken.text();
	assert.equal(broken.status, 503, 'erreur lisible au lieu de 500');
	assert.match(brokenHtml, /kDrive refuse le jeton/);
	assert.match(brokenHtml, /diagnostic/);
	const brokenDiagnostic = await (await call('/diagnostic')).text();
	assert.match(brokenDiagnostic, /Un réglage bloque/);
	assert.match(brokenDiagnostic, /not_authorized/);
	kdrive.setToken(kdrive.token);

	console.log(
		`kDrive storage tests passed (${kdrive.stats.uploads} envois, ${kdrive.stats.downloads} lectures, ${kdrive.stats.lists} listes).`
	);
} finally {
	kdrive.server.close();
	await rm(workDir, { recursive: true, force: true });
}
