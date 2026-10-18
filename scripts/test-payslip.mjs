// Chiffres lus dans les bulletins et AEM, et recalcul d'un contrat à partir de ses documents.
// Textes fictifs, construits sur les mises en page réelles (GHS sPAIEctacle, Lit Up).
import assert from 'node:assert/strict';

import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });

const ghs = (lines, recap, nets) =>
	`libellé base Part salarié Part employeur Siret Période Cie Imaginaire 12 rue Fictive du 02/06/26 au 04/06/26 75000 Paris Bulletin de paie NIR Emploi Statut Taux salarial ${lines} MONTANT BRUT ${nets.gross} Santé ${nets.social ? `MONTANT NET SOCIAL ${nets.social} ` : ''}NET A PAYER AVANT IMPOT SUR LE REVENU ${nets.nap} Montant net imposable Net payé Cumul Période BASE ${recap} Salaire brut ${nets.gross} Dans votre intérêt ${nets.paid ? `${nets.paid} € Total versé par l'employeur 499,00 € ` : ''}GHS - sPAIEctacle ©`;
const aem = (counts, gross) =>
	`0 9 2 0 ECAS0 78 X 11122233700011 9004Z CIE IMAGINAIRE 75000 PARIS ARTISTE VISUEL ARRCO X X 02 06 2026 04 06 2026 X ${counts} ${gross} ${gross} 12,15 37,00 37,00 DUPONT JEAN PRESIDENT FIN DE CDD GHS sPAIEctacle AEM`;

try {
	const m = await server.ssrLoadModule('/src/lib/server/payslipFigures.ts');

	// Cachets seuls : 3 cachets = 36 h ; le net retenu est le net payé (après impôt à la source).
	const cachets = m.readFigures(
		ghs('1 Cachet(s) répétition(s) 62,00 62,00 2 Cachet(s) répétition(s) 122,10 244,20', 'Cachets 3,00 3,00 Jours 3,00 6,00', {
			gross: '306,20',
			social: '237,09',
			nap: '237,09',
			paid: '234,85'
		}),
		'Fiche de paie'
	);
	assert.deepEqual(
		[cachets.hours, cachets.cachets, cachets.grossSalary, cachets.netSalary, cachets.netSocial, cachets.startDate],
		[36, 3, 306.2, 234.85, 237.09, '2026-06-02']
	);

	// Journées et cachets, récapitulatif sans les cachets : 4 × 6 h + 3 cachets = 60 h.
	const mixed = m.readFigures(
		ghs('4 Journée(s) de 6 heures 72,12 288,48 3 Cachet(s)+ 144,24 432,72', 'Heures 24,00 24,00 Jours 7,00 7,00', {
			gross: '721,20',
			social: '558,44',
			nap: '558,44',
			paid: '558,44'
		}),
		'Fiche de paie'
	);
	assert.deepEqual([mixed.hours, mixed.cachets], [60, 3]);

	// Récapitulatif qui compte déjà les cachets : 4 cachets, BASE Heures 48.
	const converted = m.readFigures(
		ghs('4 Cachet(s) isolé(s) 170,00 680,00', 'Heures 48,00 168,00 Jours 4,00 19,00', {
			gross: '680,00',
			social: '526,59',
			nap: '526,59',
			paid: '526,59'
		}),
		'Fiche de paie'
	);
	assert.deepEqual([converted.hours, converted.cachets], [48, 4]);

	// Ancien bulletin GHS (avant 2023) : pas de net social, le net est « net à payer avant impôt ».
	const old = m.readFigures(
		ghs('3 Journée(s) de 8 heures 1 forfait 320,82 320,82', 'Heures 24,00 24,00 Jours 3,00 3,00', {
			gross: '320,82',
			nap: '243,55'
		}),
		'Fiche de paie'
	);
	assert.deepEqual([old.hours, old.netSalary, old.grossSalary], [24, 243.55, 320.82]);

	// Services de répétition : 2 services de 4 heures.
	assert.equal(
		m.readFigures(ghs('2 Service de répétition 4 heures 57,00 114,00', 'Cachets Jours 2,00 2,00', { gross: '114,00', nap: '88,26' }), 'Fiche de paie').hours,
		8
	);

	// AEM : heures, cachets, jours ; deux nombres = cachets et jours si le « taux horaire » dépasse 60 €.
	assert.deepEqual(
		(({ hours, cachets, days }) => [hours, cachets, days])(m.readFigures(aem('24 3 7', '721,20'), 'AEM')),
		[60, 3, 7]
	);
	assert.deepEqual(
		(({ hours, cachets, days }) => [hours, cachets, days])(m.readFigures(aem('3 3', '432,00'), 'AEM')),
		[36, 3, 3]
	);
	assert.deepEqual(
		(({ hours, cachets, days, grossSalary }) => [hours, cachets, days, grossSalary])(m.readFigures(aem('40 5', '1 800,00'), 'AEM')),
		[40, undefined, 5, 1800]
	);

	// Bulletin Lit Up : la ligne du mois commence par les heures et finit par le net à payer.
	const litUp = m.readFigures(
		"BULLETIN DE PAIE Le net imposable à déclarer est indiqué dans le cadre ci-dessus sur la ligne cumul. 24,00 378,00 260,00 62,56 204,88 145,76 145,76 62,56 260,00 378,00 24,00 197,44 SARL IMAGINAIRE 01/10/2021 au 02/10/2021",
		'Fiche de paie'
	);
	assert.deepEqual([litUp.hours, litUp.grossSalary, litUp.netSalary, litUp.startDate], [24, 260, 197.44, '2021-10-01']);

	// Recalcul d'un contrat payé sur deux bulletins, avec une copie en double du premier.
	const doc = (id, kind, text) => ({ id, kind, extractedTextPreview: text });
	const first = ghs('3 Cachet(s) 144,00 432,00', 'Cachets 3,00 3,00', { gross: '432,00', nap: '334,53', paid: '334,53' });
	const second = first.replace('du 02/06/26 au 04/06/26', 'du 05/06/26 au 05/06/26').replace(/432,00/g, '144,00').replace('Cachets 3,00', 'Cachets 1,00').replace('3 Cachet', '1 Cachet').replace(/334,53/g, '111,51');
	const documents = [
		doc('a', 'Fiche de paie', first),
		doc('b', 'Fiche de paie', first),
		doc('c', 'Fiche de paie', second),
		doc('d', 'AEM', aem('4 4', '576,00').replace('04 06 2026 X', '05 06 2026 X'))
	];
	const contract = { id: 'k', documentIds: ['a', 'b', 'c', 'd'], hours: 4, cachets: 0, grossSalary: 576, netSalary: 0, startDate: '2026-06-02', endDate: '2026-06-02' };
	const { fields } = m.consolidateContract(contract, documents);
	assert.deepEqual(
		[fields.hours, fields.cachets, fields.grossSalary, fields.netSalary, fields.startDate, fields.endDate],
		[48, 4, undefined, 446.04, undefined, '2026-06-05']
	);

	// PDF Zeendoc regroupant deux paies : un lot par bulletin, avec l'AEM et le certificat
	// dont la période le recouvre (contrat du 29/10 au 02/11 payé en novembre pour les 01 et 02).
	const pdf = await PDFDocument.create();
	const font = await pdf.embedFont(StandardFonts.Helvetica);
	const pageTexts = [
		'Bulletin de paie Siret Periode Cie Imaginaire du 01/11/24 au 02/11/24 MONTANT BRUT 194,00',
		'Bulletin de paie Siret Periode Cie Imaginaire du 27/11/24 au 28/11/24 MONTANT BRUT 285,12',
		'Attestation employeur mensuelle AEM 29 10 2024 02 11 2024 X 16 2 194,00 194,00',
		'Attestation employeur mensuelle AEM 27 11 2024 28 11 2024 X 2 2 285,12 285,12',
		'CERTIFICAT D EMPLOI LES CONGES SPECTACLES 27 11 2024 28 11 2024 2 285 285',
		'CERTIFICAT D EMPLOI LES CONGES SPECTACLES 29 10 2024 02 11 2024 2 194 194'
	];
	for (const text of pageTexts) pdf.addPage([595, 842]).drawText(text, { x: 20, y: 800, size: 8, font });
	const parts = await server.ssrLoadModule('/src/lib/server/pdfParts.ts');
	const bundles = await parts.splitIntoBundles('Paies novembre.pdf', Buffer.from(await pdf.save()));
	const pagesOf = async (bundle) => (await PDFDocument.load(bundle.buffer)).getPageCount();
	assert.deepEqual(
		bundles.map((bundle) => bundle.fileName),
		['Paies novembre (2024-11-01).pdf', 'Paies novembre (2024-11-27).pdf']
	);
	assert.deepEqual([await pagesOf(bundles[0]), await pagesOf(bundles[1])], [3, 3]);
	// Un seul bulletin : le fichier reste entier.
	const single = await PDFDocument.create();
	for (const text of [pageTexts[0], pageTexts[2]]) single.addPage([595, 842]).drawText(text, { x: 20, y: 800, size: 8, font });
	assert.equal((await parts.splitIntoBundles('Paie.pdf', Buffer.from(await single.save()))).length, 1);

	// Repas : le net reste le net payé du bulletin, repas compris ; les repas sont notés à part.
	const meals = m.readFigures(
		ghs('2 Cachet(s) 121,34 242,68 MONTANT NET SOCIAL 183,59 2 Défraiement repas 20,7 20,70 41,40', 'Heures 16,00 16,00', { gross: '242,68', nap: '224,99', paid: '224,99' }),
		'Fiche de paie'
	);
	assert.deepEqual([meals.netSalary, meals.allowances], [224.99, 41.4]);

	// Emploi lu sur l'AEM, et annexe qui en découle.
	assert.equal(m.readFigures(aem('3 3', '432,00'), 'AEM').job, 'Artiste visuel');
	const annex = await server.ssrLoadModule('/src/lib/annex.ts');
	assert.equal(annex.contractAnnex({ employmentStatus: 'Artiste visuel' }), 'Annexe 10');
	assert.equal(annex.contractAnnex({ employmentStatus: 'Clown' }), 'Annexe 10');
	assert.equal(annex.contractAnnex({ employmentStatus: 'VJj ( videojokey )' }), 'Annexe 10');
	assert.equal(annex.contractAnnex({ employmentStatus: 'T e c h n i c i e n v i d e o' }), 'Annexe 8');
	assert.equal(annex.contractAnnex({ employmentStatus: 'Régisseur plateau' }), 'Annexe 8');
	assert.equal(annex.contractAnnex({ employmentStatus: '' }), '');
	const split = annex.annexSplit([
		{ employmentStatus: 'Technicien vidéo', hours: 100, cachets: 0, startDate: '2026-01-01', endDate: '2026-01-05' },
		{ employmentStatus: 'Artiste visuel', hours: 60, cachets: 0, startDate: '2026-03-01', endDate: '2026-03-05' }
	]);
	assert.deepEqual([split.annex8, split.annex10, split.majority, split.lastAnnex], [100, 60, 'Annexe 8', 'Annexe 10']);

	// Un net corrigé à la main n'est plus remplacé par la lecture du bulletin.
	const locked = m.consolidateContract({ ...contract, netSalary: 440, manualFields: ['netSalary'] }, documents).fields;
	assert.equal(locked.netSalary, undefined);
	assert.equal(locked.hours, 48);

	console.log('Payslip figures tests passed.');
} finally {
	await server.close();
}
