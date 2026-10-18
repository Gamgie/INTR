// Plan de rangement kDrive sur des noms réels du dossier de Clément.
import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true } });

const company = (id, name) => ({ id, name, legalName: '', siret: '', siren: '' });
const contract = (id, companyId, startDate) => ({ id, companyId, startDate, endDate: startDate, hours: 10, cachets: 0, employmentStatus: '', grossSalary: 100 });
const document = (id, contractId, kind, preview = '') => ({ id, contractId, kind, extractedFields: {}, extractedTextPreview: preview });
const file = (id, path, importable = true) => ({ id, name: path.split('/').at(-1), path, group: path.includes('/') ? path.split('/')[0] : '', parentId: 1, importable });
const imported = (fileId, documentIds, periodIds = []) => ({ fileId, status: 'importé', documentIds, periodIds });

try {
	const { buildOrganizePlan, dateFromText, employerFromName, parseTextDate } = await server.ssrLoadModule('/src/lib/organize.ts');
	const today = new Date('2026-10-18T12:00:00');

	// Zeendoc : AAAA_MM_AA = mois seulement ; la date finale (dépôt) est ignorée.
	assert.deepEqual(parseTextDate('Bulletin de paie_GAMGIE (COMPAGNIE)_2024_10_24_RIGNAULT_Clément RIGNAULT_2024-10-21.Zeendoc.pdf'), { date: '2024-10-01', dayKnown: false });
	assert.deepEqual(parseTextDate('Contrat de travail_GAMGIE (COMPAGNIE)_2026_04_26__RIGNAULT Clément_2026-04-21.Zeendoc.pdf'), { date: '2026-04-01', dayKnown: false });
	assert.deepEqual(parseTextDate('[AEM] 2024-11-09 Baron Production.pdf'), { date: '2024-11-09', dayKnown: true });
	assert.equal(dateFromText('THEORIZ Paie Clément 05.2022.pdf'), '2022-05-01');
	assert.equal(dateFromText('Archive/2024/06/x.pdf'), '2024-06-01');
	assert.equal(employerFromName('Bulletin de paie_GAMGIE (COMPAGNIE)_2026_07_26_RIGNAULT.pdf'), 'GAMGIE (COMPAGNIE)');
	assert.equal(employerFromName('[AEM] 2024-11-09 Baron Production.pdf'), 'Baron Production');

	const data = {
		companies: [company('g', 'Compagnie Gamgie'), company('b', 'Baron Production'), company('t', 'THEORIZ')],
		contracts: [
			contract('k1', 't', '2022-05-03'),
			contract('k2', '', '2026-07-14'),
			contract('k3', '', '2025-12-02'),
			contract('k4', 'g', '2026-04-10'),
			contract('k5', 'g', '2026-04-24')
		],
		documents: [
			document('d1', 'k1', 'Fiche de paie'),
			document('d2', 'k2', 'Fiche de paie'),
			document('d3', 'k3', 'Contrat', 'CONTRAT\nEmployeur : Ultreia\nSIRET 123'),
			document('d4', 'k4', 'Fiche de paie'),
			document('d5', 'k5', 'Fiche de paie'),
			document('d6', 'k5', 'Fiche de paie')
		],
		periods: [{ id: 'p1', admissionDate: '2025-11-28', anniversaryDate: '2026-11-15' }],
		monthlyInfos: [],
		kdriveImports: [imported(1, ['d1']), imported(2, ['d2']), imported(3, ['d3']), imported(4, ['d4']), imported(5, ['d5']), imported(9, [], ['p1']), imported(12, ['d6'])],
		settings: { activePeriodId: '', anniversaries: { 2026: '2026-11-15' }, ownerFirstName: 'Clément' }
	};
	const files = [
		file(1, '2022/theoriz paie mai.pdf'),
		file(2, '2026/07/Compagnie Gamgie/Bulletin de paie_GAMGIE (COMPAGNIE)_2026_07_26_RIGNAULT_Clément.pdf'),
		file(3, 'GUSO/contrat ultreia.pdf'),
		file(4, '2026/04/Compagnie Gamgie/bp avril a.pdf'),
		file(5, '2026/04/Compagnie Gamgie/bp avril b.pdf'),
		file(6, 'Archive/2024/11/Baron/[AEM] 2024-11-09 Baron Production.pdf'),
		file(7, 'Ressource/guide intermittence.pdf'),
		file(8, 'Déclaration.xlsx', false),
		file(9, 'notification.pdf'),
		file(10, 'Archive/notes sans date.pdf'),
		file(11, 'Archive/2022/THEORIZ Paie Clément 05.2022.pdf'),
		file(12, '2026/04/Compagnie Gamgie/bp avril bis.pdf'),
		file(13, 'Archive/2024/10/Compagnie Gamgie/Contrat de travail_GAMGIE (COMPAGNIE)_2024_10_24___2024-10-21.Zeendoc.pdf')
	];

	const plan = buildOrganizePlan(data, files, today);
	const target = Object.fromEntries(plan.moves.map((move) => [move.fileId, move.toPath]));

	assert.equal(plan.currentYear, 2026);
	assert.equal(target[1], 'Archive/2022/05/THEORIZ/[BP] 2022-05-03 THEORIZ.pdf', 'bulletin THEORIZ de mai 2022');
	assert.equal(target[2], '2026/07/Compagnie Gamgie/[BP] 2026-07-14 Compagnie Gamgie.pdf', 'employeur via le nom Zeendoc');
	assert.equal(target[3], '2026/12 (2025)/Ultreia/[CT] 2025-12-02 Ultreia.pdf', 'décembre 2025 dans l’année 2026');
	assert.equal(target[4], '2026/04/Compagnie Gamgie/[BP] 2026-04-10 Compagnie Gamgie.pdf');
	assert.equal(target[5], '2026/04/Compagnie Gamgie/[BP] 2026-04-24 Compagnie Gamgie.pdf', 'jour dans le nom');
	assert.equal(target[6], 'Archive/2024/11/Baron Production/[AEM] 2024-11-09 Baron Production.pdf', 'sans analyse, d’après le nom');
	assert.equal(plan.moves.find((move) => move.fileId === 6).basis, 'nom du fichier');
	assert.equal(target[12], '2026/04/Compagnie Gamgie/[BP] 2026-04-24 Compagnie Gamgie 2.pdf', 'homonyme numéroté');
	assert.equal(target[11], 'Archive/2022/05/THEORIZ/[BP] 2022-05 THEORIZ.pdf', 'jour inconnu : année-mois seulement');
	assert.equal(target[13], 'Archive/2024/10/Compagnie Gamgie/[CT] 2024-10 Compagnie Gamgie.pdf', 'Zeendoc non analysé : mois seulement');
	// Un bulletin analysé prend la date de début du contrat, même si son nom Zeendoc dit autre chose.
	assert.equal(plan.moves.find((move) => move.fileId === 2).date, '2026-07-14');
	assert.equal(target[9], '2026/11 (2025)/France Travail/[ARE] 2025-11-28 France Travail.pdf');
	assert.deepEqual(
		plan.skipped.map((skip) => [skip.fileId, skip.reason]).sort(),
		[[10, 'aucune date trouvée (importe-le d’abord)'], [7, 'dossier Ressource laissé tel quel'], [8, 'format non analysé']].sort()
	);

	// Après rangement, un nouveau plan ne bouge plus rien.
	const after = files.map((item) => {
		const move = plan.moves.find((entry) => entry.fileId === item.id);
		return move ? { ...item, path: move.toPath, name: move.toName, group: move.toDirs[0] } : item;
	});
	const again = buildOrganizePlan(data, after, today);
	assert.equal(again.moves.length, 0, `relance sans effet (${again.moves.map((m) => m.fromPath + ' -> ' + m.toPath).join(' | ')})`);

	// Après l'anniversaire, 2026 passe dans Archive.
	const later = buildOrganizePlan(data, after, new Date('2026-11-20T12:00:00'));
	assert.ok(later.moves.every((move) => move.toPath.startsWith('Archive/')) && later.moves.some((move) => move.fileId === 2));

	console.log('Organize plan tests passed.');
} finally {
	await server.close();
}
