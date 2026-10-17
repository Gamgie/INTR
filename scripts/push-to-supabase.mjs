#!/usr/bin/env node
// Envoie le contenu local (data/intermittens.json + data/documents/) vers Supabase.
// Usage : SUPABASE_URL=... SUPABASE_SECRET_KEY=... node scripts/push-to-supabase.mjs [--force]
// Sans --force, le script refuse d'écraser des données distantes non vides.

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const bucket = process.env.SUPABASE_BUCKET || 'documents';
const force = process.argv.includes('--force');
const dataDir = path.resolve(process.argv.find((arg) => arg.startsWith('--data='))?.slice(7) || 'data');

if (!url || !key) {
	console.error('SUPABASE_URL et SUPABASE_SECRET_KEY sont requis.');
	process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const data = JSON.parse(await readFile(path.join(dataDir, 'intermittens.json'), 'utf-8'));

const { data: remote, error: readError } = await supabase
	.from('intermittens_data')
	.select('data')
	.eq('id', 'main')
	.maybeSingle();
if (readError) throw readError;

const remoteCount =
	(remote?.data?.contracts?.length ?? 0) + (remote?.data?.documents?.length ?? 0);
if (remoteCount > 0 && !force) {
	console.error(`Supabase contient déjà ${remoteCount} contrats/documents. Relancer avec --force pour écraser.`);
	process.exit(1);
}

const files = await readdir(path.join(dataDir, 'documents')).catch(() => []);
let sent = 0;
for (const name of files) {
	const buffer = await readFile(path.join(dataDir, 'documents', name));
	const { error } = await supabase.storage.from(bucket).upload(name, buffer, {
		upsert: true,
		contentType: name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream'
	});
	if (error) throw new Error(`${name}: ${error.message}`);
	sent += 1;
	if (sent % 20 === 0) console.log(`${sent}/${files.length} fichiers envoyés`);
}

const { error: writeError } = await supabase
	.from('intermittens_data')
	.upsert({ id: 'main', data, updated_at: new Date().toISOString() });
if (writeError) throw writeError;

console.log(
	`Terminé : ${sent} fichiers, ${data.contracts.length} contrats, ${data.documents.length} documents, ${data.periods.length} périodes.`
);
