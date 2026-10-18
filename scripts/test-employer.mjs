// Lecture de l'employeur et de la date de contrat dans le texte des documents.
// Textes fictifs, construits sur les mises en page réelles (GHS sPAIEctacle, Audiens, contrats).
import assert from 'node:assert/strict';

import { createServer } from 'vite';

const server = await createServer({ appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });

// SIRET fictifs valides (clé de Luhn).
const OPERA = '11122233700011';
const CIE = '44455566800011';
const SIGLE = '77788899100018';
const spaced = (siret) => `${siret.slice(0, 3)} ${siret.slice(3, 6)} ${siret.slice(6, 9)} ${siret.slice(9)}`;

const bulletin = (name, siret, number = 601) =>
	`libellé base Part salarié Part employeur Siret Période ${name} ${number} CS 63126 du 25/09/20 au 27/09/20 35000 RENNES ${spaced(siret)} 9004Z Règlement 27/09/20 par virement Analytique "Spectacle imaginaire" Conseiller technique Jean DUPONT Non Cadre`;
const aem = (name, siret) =>
	`0 9 2 0 ECAS010472 78 X ${siret} 9004Z 80001140647 9999 ${name} 0223622800 35000 RENNES x@y.fr X X 1-1114491 X 23107001F RIC DUPONT JEAN 188062432205914 09 06 1988 X 1 RUE IMAGINAIRE 69007 LYON CONSEILLER TECHNIQUE 207Z20269862 ARRCO X X 24 09 2020 27 09 2020 X 24 3 320,82 GHS sPAIEctacle AEM`;
const conges = (name, siret) =>
	`JEAN DUPONT 1 rue Imaginaire 69007 LYON ${siret.slice(0, 9)} ${siret.slice(9)} 23107001F 22818 1880624322059 14 ${name} DUPONT JEAN CONSEILLER TECHNIQUE NON 25 09 2020 27 09 2020 3 321 321 27/09/20 MARTIN CERTIFICAT D'EMPLOI LES CONGES SPECTACLES DESTINÉ AU SALARIÉ Audiens`;

try {
	const m = await server.ssrLoadModule('/src/lib/employer.ts');

	// Bulletin GHS : le nom suit « Siret Période » et s'arrête avant le numéro et « CS 63126 ».
	const b = m.readEmployer(bulletin('VILLE DE RENNES - OPERA', OPERA));
	assert.deepEqual([b.name, b.siren, b.format], ['VILLE DE RENNES - OPERA', OPERA.slice(0, 9), 'bulletin']);
	// Le nom du projet (« Spectacle imaginaire », dossier mal nommé) n'est jamais pris pour l'employeur.
	assert.ok(!/imaginaire/i.test(b.name));

	// AEM : le nom s'arrête au téléphone ou au code postal, même s'il contient un chiffre.
	assert.equal(m.readEmployer(aem('CIE 32 NOVEMBRE', CIE)).name, 'CIE 32 NOVEMBRE');
	assert.equal(m.readEmployer(aem('VILLE DE RENNES - OPERA', OPERA)).siren, OPERA.slice(0, 9));

	// Congés Spectacles : entre le NIR et « NOM PRÉNOM » du salarié.
	const c = m.readEmployer(conges('AADN', SIGLE));
	assert.deepEqual([c.name, c.siren, c.format], ['AADN', SIGLE.slice(0, 9), 'conges']);

	// Contrats : « Entre les soussignés », société, adresse, Siège, Sous le N°.
	assert.equal(m.readEmployer('Contrat Entre les soussignés : La société SARL THEORIZ, au capital de 5 000 euros, siret ' + CIE).name, 'THEORIZ');
	assert.equal(m.readEmployer('Page 1 / 4 CONTRAT Entre les soussignés CIE 32 NOVEMBRE 2 bis rue des cols verts 74940 Annecy Siret : ' + spaced(CIE)).name, 'CIE 32 NOVEMBRE');
	assert.equal(m.readEmployer('CONTRAT Entre les soussignés AADN Siège social :2 Rue d\'Arménie, 69003 LYON Siret : ' + SIGLE).name, 'AADN');
	assert.equal(m.readEmployer('ENTRE LES SOUSSIGNES : Compagnie michel Onomo Sous le N° 837866359').name, 'Compagnie michel Onomo');
	assert.equal(m.readEmployer('Il est souscrit entre les soussignés un contrat d\'engagement entre :\nCompagnie Ultreia\n\nCentre Culturel').name, 'Compagnie Ultreia');
	assert.equal(m.readEmployer('LIT UP – 18 RUE DES CAPUCINS – 69001 LYON').name, 'LIT UP');
	// Phrases du contrat jamais prises pour un nom.
	assert.equal(m.readEmployer('Le SALARIE est immatriculé. Le SALARIE pourra exercer auprès de cet organisme')?.name ?? '', '');

	// Texte à police décalée (« &2175$7 » = « CONTRAT ») : rapproché seulement d'un nom connu.
	const garbled = 'Entre les soussignés AUGMENTED MAGIC , dont le siège'.replace(/[\x21-\x7e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 29)).replace(/ /g, '\u0003');
	const decoded = m.readEmployer(garbled);
	assert.equal(decoded.decoded, true);
	const known = m.buildEmployerDirectory([], {}, [{ name: 'MAGIC MOULLA (AUGMENTED MAGIC)', siret: '' }]);
	assert.equal(m.employerName(decoded, known), 'MAGIC MOULLA (AUGMENTED MAGIC)');

	// Répertoire par SIREN : un nom pour tous les documents d'un employeur.
	const readings = [
		m.readEmployer(bulletin('Cie', CIE, 85)), // forme coupée par le numéro
		m.readEmployer(aem('CIE 32 NOVEMBRE', CIE)),
		m.readEmployer(conges('CIE 32 NOVEMBRE', CIE)),
		m.readEmployer(bulletin('VILLE DE RENNES - OPERA', OPERA)),
		m.readEmployer(conges('AADN', SIGLE))
	];
	const directory = m.buildEmployerDirectory(readings);
	assert.equal(directory.bySiren.get(CIE.slice(0, 9)), 'Cie 32 Novembre', 'forme complète retenue');
	assert.equal(directory.bySiren.get(OPERA.slice(0, 9)), 'Ville de Rennes - Opera');
	assert.equal(directory.bySiren.get(SIGLE.slice(0, 9)), 'AADN', 'sigle gardé en capitales');
	// Correction à la main : prioritaire pour tous les fichiers du SIREN.
	const corrected = m.buildEmployerDirectory(readings, { [OPERA.slice(0, 9)]: 'Ville de Rennes - Opéra' });
	assert.equal(m.employerName(readings[3], corrected), 'Ville de Rennes - Opéra');

	// Dates : début de contrat (AEM) avant période payée (bulletin, congés).
	assert.deepEqual(m.readPeriodStart(aem('X', OPERA)), { date: '2020-09-24', source: 'contrat' });
	assert.deepEqual(m.readPeriodStart(bulletin('X', OPERA)), { date: '2020-09-25', source: 'periode' });
	assert.deepEqual(m.readPeriodStart(conges('X', OPERA)), { date: '2020-09-25', source: 'periode' });
	assert.equal(m.readHeaderMonth('5MICH##AEM##11-2022##1UNUOSI9GA##DUPONT'), '2022-11');

	console.log('Employer reading tests passed.');
} finally {
	await server.close();
}
