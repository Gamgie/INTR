#!/usr/bin/env node
// After `vite build` on Vercel: copy files that are loaded dynamically, which Vercel's file
// tracer cannot see, into every serverless function that needs them:
// - the French OCR model (tesseract.js)
// - the pdf.js worker, character maps and standard fonts (text extraction, page rendering)
import { cp, lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const functionsRoot = path.resolve('.vercel/output/functions');
const copies = [
	{ marker: 'node_modules/tesseract.js', from: 'node_modules/@tesseract.js-data/fra' },
	{ marker: 'node_modules/tesseract.js', from: 'node_modules/tesseract.js-core' },
	{ marker: 'node_modules/tesseract.js', from: 'node_modules/tesseract.js/src' },
	{ marker: 'node_modules/pdfjs-dist', from: 'node_modules/pdfjs-dist/legacy/build' },
	{ marker: 'node_modules/pdfjs-dist', from: 'node_modules/pdfjs-dist/cmaps' },
	{ marker: 'node_modules/pdfjs-dist', from: 'node_modules/pdfjs-dist/standard_fonts' }
];

async function* functionDirs(dir) {
	for (const entry of await readdir(dir)) {
		const full = path.join(dir, entry);
		const info = await lstat(full);
		if (info.isSymbolicLink()) continue;
		if (!info.isDirectory()) continue;
		if (entry.endsWith('.func')) yield full;
		else yield* functionDirs(full);
	}
}

let copied = 0;
try {
	await stat(functionsRoot);
} catch {
	console.log('Pas de sortie Vercel, rien à copier.');
	process.exit(0);
}

for await (const dir of functionDirs(functionsRoot)) {
	for (const { marker, from } of copies) {
		try {
			await stat(path.join(dir, marker));
		} catch {
			continue;
		}
		await cp(path.resolve(from), path.join(dir, from), { recursive: true });
		copied += 1;
	}
}
console.log(`${copied} dossier(s) chargés dynamiquement copiés dans les fonctions Vercel.`);
