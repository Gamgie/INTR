// Plan de rangement kDrive : employeur et date toujours lus dans le texte des documents.
// Textes fictifs construits sur les mises en page réelles (GHS sPAIEctacle, Audiens, contrats).
import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });

const OPERA = '11122233700011';
const CIE = '44455566800011';
const spaced = (siret) => `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`;
const bulletin = (name, siret, from, to) =>
	`libellé base Part salarié Part employeur Siret Période ${name} 12 4 rue Imaginaire du ${from} au ${to} 35000 RENNES ${spaced(siret)} 9004Z Règlement par virement`;
const aem = (name, siret, start, end) =>
	`0 9 2 0 ECAS010472 78 X ${siret} 9004Z 80001140647 9999 ${name} 0223622800 35000 RENNES X X 1-1114491 X RIC DUPONT JEAN 188062432205914 09 06 1988 X 1 RUE IMAGINAIRE 69007 LYON TECHNICIEN 207Z20269862 ARRCO X X ${start} ${end} X 24 3 GHS sPAIEctacle AEM`;
const conges = (name, siret, start, end) =>
	`JEAN DUPONT 1 rue Imaginaire 69007 LYON ${siret.slice(0, 9)} ${siret.slice(9)} 23107001F 22818 1880624322059 14 ${name} DUPONT JEAN TECHNICIEN NON ${start} ${end} 3 321 321 CERTIFICAT D'EMPLOI LES CONGES SPECTACLES Audiens`;

const contract = (id, startDate, endDate = startDate) => ({ id, companyId: '', startDate, endDate, hours: 10, cachets: 0, employmentStatus: '', grossSalary: 100 });
const doc = (id, contractId, kind, text) => ({ id, contractId, kind, extractedFields: {}, extractedTextPreview: text });
const file = (id, path, importable = true) => ({ id, name: path.split('/').at(-1), path, group: path.includes('/') ? path.split('/')[0] : '', parentId: 1, importable });
const imported = (fileId, documentIds, periodIds = []) => ({ fileId, status: 'importé', documentIds, periodIds });

try {
	const { buildOrganizePlan, parseTextDate } = await server.ssrLoadModule('/src/lib/organize.ts');
	const today = new Date('2026-10-18T12:00:00');

	assert.deepEqual(parseTextDate('Bulletin de paie_GAMGIE (COMPAGNIE)_2024_10_24_RIGNAULT_2024-10-21.Zeendoc.pdf'), { date: '2024-10-01', dayKnown: false });

	const data = {
		companies: [],
		contracts: [
			contract('k1', '2020-09-24', '2020-09-27'),
			contract('k2', '2023-01-16', '2023-02-02'),
			contract('wrong', '2022-12-01', '2022-12-02'),
			contract('k4', '2026-07-20', '2026-07-25')
		],
		documents: [
			// « Spectacle imaginaire » : un dossier au nom du projet, mais l'employeur est lu dans le document.
			doc('d1', 'k1', 'Fiche de paie', bulletin('VILLE DE RENNES - OPERA', OPERA, '25/09/20', '27/09/20')),
			doc('d2', 'k1', 'AEM', aem('VILLE DE RENNES - OPERA', OPERA, '24 09 2020', '27 09 2020')),
			doc('d3', 'k1', 'Congé Spectacle', conges('VILLE DE RENNES - OPERA', OPERA, '25 09 2020', '27 09 2020')),
			// Contrat de janvier à février : la paie de février garde la date du contrat.
			doc('f1', 'k2', 'Fiche de paie', bulletin('Cie', CIE, '01/02/23', '02/02/23')),
			doc('f2', 'k2', 'AEM', aem('CIE 32 NOVEMBRE', CIE, '16 01 2023', '02 02 2023')),
			// Rattaché par erreur à un contrat de décembre : la période lue dans le document l'emporte.
			doc('w1', 'wrong', 'Fiche de paie', bulletin('Cie', CIE, '16/11/22', '19/11/22')),
			// Rien de lisible : à vérifier, jamais rangé au hasard.
			doc('x1', 'k4', 'Déclaration Guso', ', , , , TOUTES VOS DÉMARCHES SUR : E M P L O Y E U R'),
			// Une page de contrat prise pour une notification ARE ne change pas le code.
			doc('c1', 'k4', 'Contrat', `Entre les soussignés CIE 32 NOVEMBRE 2 bis rue des cols verts 74940 Annecy Siret : ${spaced(CIE)}`)
		],
		periods: [{ id: 'p1', admissionDate: '2026-07-20', anniversaryDate: '2027-07-19' }],
		monthlyInfos: [],
		kdriveImports: [
			imported(1, ['d1']),
			imported(2, ['d2']),
			imported(3, ['d3']),
			imported(4, ['f1', 'f2']),
			imported(5, ['w1']),
			imported(6, ['x1']),
			imported(7, ['c1'], ['p1'])
		],
		settings: { activePeriodId: '', anniversaries: { 2026: '2026-11-15' }, employerNames: {} }
	};
	const files = [
		file(1, 'Archive/2020/Spectacle imaginaire/20-ric-601-Paie.pdf'),
		file(2, 'Archive/2020/Spectacle imaginaire/20-ric-601-AEM.pdf'),
		file(3, 'Archive/2020/Spectacle imaginaire/20-ric-601-CS.pdf'),
		file(4, 'Archive/2023/Cie/02/BS-AEM-CS fev 23.pdf'),
		file(5, 'Archive/2022/Cie/bp-novembre.pdf'),
		file(6, 'Archive/2023/GUSO/FeuilletDeclaration.pdf'),
		file(7, '2026/07/Cie 32 Novembre/[CTT] 2026-07-20 CIE32NOVEMBRE.pdf'),
		file(8, 'Archive/2024/pas-importe.pdf'),
		file(9, 'Ressource/guide.pdf'),
		file(10, 'Déclaration.xlsx', false)
	];

	const plan = buildOrganizePlan(data, files, today);
	const target = Object.fromEntries(plan.moves.map((move) => [move.fileId, move.toPath]));

	assert.equal(target[1], 'Archive/2020/09/Ville de Rennes - Opera/[BP] 2020-09-24 Ville de Rennes - Opera.pdf', 'employeur lu, pas le projet');
	assert.equal(target[2], 'Archive/2020/09/Ville de Rennes - Opera/[AEM] 2020-09-24 Ville de Rennes - Opera.pdf');
	assert.equal(target[3], 'Archive/2020/09/Ville de Rennes - Opera/[CS] 2020-09-24 Ville de Rennes - Opera.pdf');
	assert.equal(target[4], 'Archive/2023/01/Cie 32 Novembre/[BP+AEM] 2023-01-16 Cie 32 Novembre.pdf', 'date du contrat, nom complet');
	assert.equal(target[5], 'Archive/2023/11 (2022)/Cie 32 Novembre/[BP] 2022-11-16 Cie 32 Novembre.pdf', 'période lue contre un mauvais rattachement');
	assert.equal(target[7], '2026/07/Cie 32 Novembre/[CT] 2026-07-20 Cie 32 Novembre.pdf', 'pas de [ARE] parasite');

	const reasons = Object.fromEntries(plan.skipped.map((skip) => [skip.fileId, skip.reason]));
	assert.match(reasons[6], /employeur introuvable/);
	assert.match(reasons[8], /pas encore importé/);
	assert.match(reasons[9], /Ressource/);
	assert.match(reasons[10], /format non analysé/);

	assert.deepEqual(
		plan.employers.map((employer) => [employer.name, employer.files]),
		[['Cie 32 Novembre', 3], ['Ville de Rennes - Opera', 3]]
	);

	// Correction d'un nom : tous les fichiers du SIREN suivent.
	const corrected = buildOrganizePlan(
		{ ...data, settings: { ...data.settings, employerNames: { [OPERA.slice(0, 9)]: 'Ville de Rennes - Opéra' } } },
		files,
		today
	);
	assert.ok(corrected.moves.filter((move) => move.fileId <= 3).every((move) => move.toPath.includes('/Ville de Rennes - Opéra/[')));
	assert.equal(corrected.employers.find((employer) => employer.siren === OPERA.slice(0, 9)).corrected, true);

	// Après rangement, un nouveau plan ne bouge plus rien.
	const after = files.map((item) => {
		const move = plan.moves.find((entry) => entry.fileId === item.id);
		return move ? { ...item, path: move.toPath, name: move.toName, group: move.toDirs[0] } : item;
	});
	assert.equal(buildOrganizePlan(data, after, today).moves.length, 0, 'relance sans effet');

	console.log('Organize plan tests passed.');
} finally {
	await server.close();
}
