// Employeur d'un document, toujours lu dans le texte du document lui-même.
//
// Formats reconnus (texte tel que l'extrait l'import, souvent une page sur une seule ligne) :
//   - bulletin GHS sPAIEctacle : « … Siret Période <Employeur> <n°> <adresse> … »
//   - AEM GHS : « … <SIRET 14> <APE> <n° 11> <IDCC> <EMPLOYEUR> <téléphone ou code postal> … »
//   - certificat Congés Spectacles (Audiens) : « <SIREN> <NIC> … <NIR 13> <clé> <EMPLOYEUR> <NOM PRÉNOM> … »
//   - contrats : « Entre les soussignés [:] [La société] <Employeur> <adresse | , | Siret> »,
//     « … entre : <Employeur> », « … le.a salarié.e <Employeur> et <NOM> » (Zeendoc)
// Le SIREN (9 premiers chiffres du SIRET) relie les documents d'un même employeur, même quand
// l'établissement change (Baron Production : 00017, 00025, 00033).

export type EmployerReading = {
	/** Nom lu dans le document, tel quel. */
	name: string;
	siren: string;
	format: 'bulletin' | 'aem' | 'conges' | 'contrat' | 'siret seul';
	/** Lu dans un texte décodé (police décalée) : espaces et accents perdus, à rapprocher d'un nom connu. */
	decoded?: boolean;
};

export function normalize(value: string) {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function luhn(digits: string) {
	let sum = 0;
	for (let index = 0; index < digits.length; index += 1) {
		let digit = Number(digits[digits.length - 1 - index]);
		if (index % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}

/** SIRET valides présents dans le texte (14 chiffres, avec ou sans espaces, clé de Luhn). */
export function sirets(text: string) {
	const found: string[] = [];
	for (const match of text.matchAll(/(?<![\d])(\d{3}) ?(\d{3}) ?(\d{3}) ?(\d{5})(?![\d])/g)) {
		const digits = match.slice(1).join('');
		if (luhn(digits) && luhn(digits.slice(0, 9)) && !found.includes(digits)) found.push(digits);
	}
	return found;
}

const LEGAL_FORMS = /^(?:la\s+soci[eé]t[eé]\s+|l['’]association\s+|association\s+)?(?:(?:sarl|sas|sasu|eurl|sa|scop|scic|sci)\s+)?/i;

function cleanName(raw: string) {
	const value = raw
		.replace(/[«»"“”]/g, ' ')
		.replace(LEGAL_FORMS, '')
		.replace(/\s+/g, ' ')
		.replace(/[\s,.;:–-]+$/, '')
		.trim();
	if (value.length < 2 || value.length > 70) return '';
	if (value.split(' ').length > 8) return '';
	if ((value.match(/\d/g) ?? []).length > 3) return '';
	if (!/[A-Za-zÀ-ÿ]{2}/.test(value)) return '';
	if (/\b(est|sont|pourra|salari|immatricul|soussign|d['’]une part|ci-apr[eè]s|n[eé]ant)\b/i.test(value)) return '';
	return value;
}

function sirenNear(text: string, start: number, length = 220) {
	const window = text.slice(Math.max(0, start), start + length);
	const siret = sirets(window)[0];
	if (siret) return siret.slice(0, 9);
	const siren = /siren\s*:?\s*(\d{3}) ?(\d{3}) ?(\d{3})(?!\d)/i.exec(window);
	return siren && luhn(siren.slice(1).join('')) ? siren.slice(1).join('') : '';
}

// Fin de nom : une adresse (« 2 bis rue », « 54 promenade »), un code postal, un champ connu.
const STREET = '(?:rue|avenue|av\\.?|bd|boulevard|place|chemin|all[ée]e|quai|impasse|route|promenade|cours|passage|r[ée]sidence|centre|mvac)';
const CONTRACT_END = new RegExp(
	`(?=\\s*\\n|,| \\d{1,4}(?: ?bis| ?ter)?,? ${STREET}\\b| \\d{5}\\b| siret| si[èe]ge| sous le n| repr[ée]sent| au capital| dont| immatricul| n° siren)`,
	'i'
);

function readPlain(text: string): EmployerReading | undefined {
	const flat = text.replace(/\s+/g, ' ');

	// Bulletin GHS : « Siret Période Compagnie Gamgie 1 21 rue … 923 195 028 00017 »
	const bulletin = /Siret P.riode (.+?)(?= \d| CS ?\d| du \d| rue)/.exec(flat);
	if (bulletin) {
		const name = cleanName(bulletin[1]);
		if (name) return { name, siren: sirenNear(flat, bulletin.index, 400), format: 'bulletin' };
	}

	// AEM GHS : « 92319502800017 9001Z 80003489302 3090 COMPAGNIE GAMGIE 69003 LYON »
	const aem = /\b(\d{14}) \d{4}[A-Z] \d{11} \d{4} (.+?) (?=\d{10}\b|\d{5}\b)/.exec(flat);
	if (aem) {
		const name = cleanName(aem[2]);
		if (name) return { name, siren: aem[1].slice(0, 9), format: 'aem' };
	}

	// AEM Unédic : « … EJAU002492 SARL LIT UP 49524178800035 69001 LYON »
	const unedic = /(?:[A-Z]{4}\d{6} )?((?:[A-ZÀ-Ý][A-ZÀ-Ý'&.-]*\s){1,6}?)(\d{14}) \d{5} [A-Z]/.exec(flat);
	if (unedic && /ANNEXES 8 et 10/i.test(flat) && luhn(unedic[2])) {
		const name = cleanName(unedic[1]);
		if (name) return { name, siren: unedic[2].slice(0, 9), format: 'aem' };
	}

	// Congés Spectacles : « CLEMENT RIGNAULT … 923195028 00017 … 1880624322059 14 COMPAGNIE GAMGIE RIGNAULT CLEMENT »
	const person = /^([A-ZÀ-Ý][A-ZÀ-Ý-]+) ([A-ZÀ-Ý][A-ZÀ-Ý-]+) /.exec(flat);
	if (person && /CONGES SPECTACLES/i.test(flat)) {
		const reversed = `${person[2]} ${person[1]}`;
		const conges = new RegExp(`\\b(\\d{9}) (\\d{5}) .{0,40}?\\d{13} \\d{2} (.+?) ${reversed}\\b`).exec(flat);
		if (conges) {
			const name = cleanName(conges[3]);
			if (name) return { name, siren: conges[1], format: 'conges' };
		}
	}

	// Contrats
	const contractStarts = [
		/entre les soussign\S*\s*:?\s*(?:la soci[ée]t[ée]\s+)?(?=[A-ZÀ-Ý])/i,
		/\bentre\s*:\s*\n?\s*(?=[A-ZÀ-Ý])/i,
		/entrelessoussign\S*\s+(?=[A-Z])/i
	];
	for (const start of contractStarts) {
		const match = start.exec(text);
		if (!match) continue;
		const rest = text.slice(match.index + match[0].length, match.index + match[0].length + 160);
		const end = CONTRACT_END.exec(rest);
		const name = cleanName(end ? rest.slice(0, end.index) : rest.split('\n')[0]);
		if (name && /^[A-ZÀ-Ý0-9]/.test(name)) {
			return { name, siren: sirenNear(text, match.index, 500), format: 'contrat' };
		}
	}
	const zeendoc = /le\.a salari[ée]\.e (.+?) et [A-ZÀ-Ý]{3,}/i.exec(text);
	if (zeendoc) {
		const name = cleanName(zeendoc[1]);
		if (name) return { name, siren: sirenNear(text, zeendoc.index, 500), format: 'contrat' };
	}

	// En-tête de contrat : « LIT UP – 18 RUE DES CAPUCINS », « SMartFr – 75, rue Léon Gambetta »
	const header = /^\s*([A-ZÀ-Ý][\wÀ-ÿ'& .-]{1,40}?) [–-] \d/.exec(text);
	if (header) {
		const name = cleanName(header[1]);
		if (name) return { name, siren: sirenNear(text, 0, 400), format: 'contrat' };
	}

	const siret = sirets(flat)[0];
	if (siret) return { name: '', siren: siret.slice(0, 9), format: 'siret seul' };

	// Movinmotion (Michel Onomo) : en-tête « …##RIGNAULT##CLEMENT GAMGIE##837866 » = début du SIREN.
	const movin = /##(\d{6})(?:\s|$)/.exec(flat);
	if (movin) return { name: '', siren: movin[1], format: 'siret seul' };
	return undefined;
}

/**
 * Certains PDF ont une police dont les caractères sont décalés d'un cran constant
 * (« &2175$7 » pour « CONTRAT ») : on essaie le décalage le plus courant si le texte brut
 * ne donne rien.
 */
export function unshift(text: string, offset = 29) {
	// Les vrais espaces (0x20) viennent de l'extraction et restent ; 0x03 devient une espace.
	return text.replace(/[\x01-\x1f\x21-\x5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) + offset));
}

/** Lit l'employeur d'un document. Renvoie undefined si rien de fiable n'est lisible. */
export function readEmployer(text: string): EmployerReading | undefined {
	if (!text.trim()) return undefined;
	const plain = readPlain(text);
	if (plain?.name) return plain;
	if (!/\b(le|la|de|du|et|les)\b/i.test(text.slice(0, 400))) {
		const decoded = readPlain(unshift(text));
		if (decoded?.name) return { ...decoded, decoded: true };
	}
	return plain;
}

const SMALL_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', 'sur', 'd', 'l']);

const COMMON_SHORT = new Set(['cie', 'lit', 'up', 'art', 'arts', 'prod', 'bal', 'son', 'fil']);

/**
 * « VILLE DE RENNES - OPERA » → « Ville de Rennes - Opera », « Compagnie michel Onomo » →
 * « Compagnie Michel Onomo » ; les sigles courts (AADN, CCNRB) restent en capitales.
 */
export function tidyEmployerName(value: string) {
	const trimmed = value.trim();
	const letters = trimmed.replace(/[^A-Za-zÀ-ÿ]/g, '');
	const shouting = Boolean(letters) && letters === letters.toUpperCase();
	return trimmed
		.split(/(\s+|-|')/)
		.map((part, index) => {
			if (!/[A-Za-zÀ-ÿ]/.test(part)) return part;
			const lower = part.toLowerCase();
			if (index > 0 && SMALL_WORDS.has(lower)) return shouting ? lower : part;
			if (shouting) {
				if (part.length <= 4 && !COMMON_SHORT.has(lower)) return part;
				return lower.charAt(0).toUpperCase() + lower.slice(1);
			}
			// Nom en casse mixte : seuls les mots écrits tout en minuscules prennent une capitale.
			return part === lower && part.length > 2 ? lower.charAt(0).toUpperCase() + lower.slice(1) : part;
		})
		.join('');
}

/** Vrai si le nom (mots de 3 lettres ou plus) figure dans le texte. */
export function nameAppearsIn(name: string, text: string) {
	const words = normalize(name).split(' ').filter((word) => word.length >= 3);
	if (!words.length) return false;
	const haystack = ` ${normalize(text)} `;
	if (words.every((word) => haystack.includes(` ${word} `))) return true;
	const squashed = words.join('');
	return squashed.length >= 5 && haystack.replace(/ /g, '').includes(squashed);
}

const FORMAT_WEIGHT: Record<EmployerReading['format'], number> = {
	bulletin: 4,
	contrat: 3,
	aem: 2,
	conges: 2,
	'siret seul': 0
};

export type EmployerDirectory = {
	/** Nom retenu pour un SIREN : le mieux écrit parmi tous les documents qui portent ce SIREN. */
	bySiren: Map<string, string>;
	/** Structures enregistrées dans l'app (onglet Structures). */
	knownNames: string[];
};

/** Construit le répertoire SIREN → nom à partir de toutes les lectures. */
export function buildEmployerDirectory(
	readings: EmployerReading[],
	overrides: Record<string, string> = {},
	known: Array<{ name: string; siret?: string; siren?: string }> = []
): EmployerDirectory {
	const votes = new Map<string, Map<string, { label: string; score: number; precise: boolean }>>();
	for (const reading of readings) {
		if (!reading.siren || !reading.name || reading.decoded) continue;
		const forms = votes.get(reading.siren) ?? new Map();
		const key = normalize(reading.name);
		const mixedCase = reading.name !== reading.name.toUpperCase();
		const entry = forms.get(key) ?? { label: reading.name, score: 0, precise: false };
		entry.score += FORMAT_WEIGHT[reading.format] + (mixedCase ? 1 : 0);
		// AEM et congés : le nom y est encadré par des champs fixes, sa fin est sûre.
		if (reading.format === 'aem' || reading.format === 'conges') entry.precise = true;
		const accented = (value: string) => /[À-ÿ]/.test(value);
		if (mixedCase && entry.label === entry.label.toUpperCase()) entry.label = reading.name;
		else if (accented(reading.name) && !accented(entry.label) && mixedCase === (entry.label !== entry.label.toUpperCase())) {
			entry.label = reading.name;
		}
		forms.set(key, entry);
		votes.set(reading.siren, forms);
	}

	const bySiren = new Map<string, string>();
	for (const [siren, forms] of votes) {
		// Les formes d'un même nom (« LA COMPAGNIE DES TROPES », « La Compagnie des Tropes ») se
		// cumulent ; une forme coupée (« CIE ») rejoint la forme complète (« CIE 32 NOVEMBRE »).
		const entries = [...forms.entries()];
		for (const [key, entry] of entries) {
			const longer = entries.find(
				([other, candidate]) => other !== key && other.startsWith(`${key} `) && candidate.precise
			);
			if (longer) {
				longer[1].score += entry.score;
				forms.delete(key);
			}
		}
		const best = [...forms.values()].sort((a, b) => b.score - a.score)[0];
		bySiren.set(siren, tidyEmployerName(best.label));
	}
	for (const company of known) {
		const siren = (company.siren || company.siret || '').replace(/\D/g, '').slice(0, 9);
		if (siren.length === 9 && company.name) bySiren.set(siren, company.name);
	}
	for (const [siren, name] of Object.entries(overrides)) {
		if (/^\d{9}$/.test(siren) && name.trim()) bySiren.set(siren, name.trim());
	}
	return { bySiren, knownNames: known.map((company) => company.name).filter(Boolean) };
}

/** Nom final de l'employeur d'un document, ou '' si rien de vérifiable. */
export function employerName(reading: EmployerReading | undefined, directory: EmployerDirectory) {
	if (!reading) return '';
	let fromSiren = reading.siren ? directory.bySiren.get(reading.siren) : undefined;
	if (!fromSiren && reading.siren.length === 6) {
		// Début de SIREN (documents Movinmotion) : seulement s'il désigne un seul employeur connu.
		const matches = [...directory.bySiren.entries()].filter(([siren]) => siren.startsWith(reading.siren));
		if (matches.length === 1) fromSiren = matches[0][1];
	}
	if (fromSiren) return fromSiren;
	if (reading.decoded) {
		// Texte décodé : on ne retient que le rapprochement exact, lettre pour lettre, avec un nom connu.
		const squashed = normalize(reading.name).replace(/ /g, '');
		if (squashed.length < 4) return '';
		const candidates = [...directory.bySiren.values(), ...directory.knownNames];
		return candidates.find((name) => normalize(name).replace(/ /g, '') === squashed)
			?? candidates.find((name) => normalize(name).replace(/ /g, '').includes(squashed))
			?? '';
	}
	return reading.name ? tidyEmployerName(reading.name) : '';
}

export type PeriodReading = {
	date: string;
	/** « contrat » : début du contrat (AEM, contrat) ; « periode » : période payée (bulletin, congés). */
	source: 'contrat' | 'periode';
};

/**
 * Date lue dans le document (AAAA-MM-JJ) :
 *   début du contrat : AEM GHS « ARRCO X X 16 01 2023 02 02 2023 », contrat « du 13/09/2023 au … » ;
 *   période payée : bulletin GHS « du 01/02/23 au 02/02/23 », congés « NON 01 02 2023 02 02 2023 ».
 */
export function readPeriodStart(text: string, kind = ''): PeriodReading | undefined {
	const flat = text.replace(/\s+/g, ' ');
	const iso = (day: string, month: string, year: string) => {
		const fullYear = year.length === 2 ? `20${year}` : year;
		const d = Number(day);
		const m = Number(month);
		return d >= 1 && d <= 31 && m >= 1 && m <= 12 ? `${fullYear}-${month}-${day}` : '';
	};
	const patterns: Array<[RegExp, PeriodReading['source']]> = [
		[/ARRCO(?: X)* (\d{2}) (\d{2}) (20\d{2}) \d{2} \d{2} 20\d{2}/, 'contrat'],
		[/Siret P.riode .{0,160}?\bdu (\d{2})\/(\d{2})\/(\d{2}) au \d{2}\/\d{2}\/\d{2}/, 'periode'],
		[/\b(?:OUI|NON) (\d{2}) (\d{2}) (20\d{2}) \d{2} \d{2} 20\d{2}/, 'periode'],
		[/P[ée]riode du (\d{2})\/(\d{2})\/(\d{2,4}) au/i, 'periode']
	];
	if (kind === 'Contrat') patterns.push([/\bdu (\d{2})\/(\d{2})\/(20\d{2}) au \d{2}\/\d{2}\/20\d{2}/, 'contrat']);
	for (const [pattern, source] of patterns) {
		const match = pattern.exec(flat);
		if (match) {
			const date = iso(match[1], match[2], match[3]);
			if (date) return { date, source };
		}
	}
	return undefined;
}

/** Mois indiqué dans l'en-tête des documents Movinmotion : « …##AEM##11-2022##… » → « 2022-11 ». */
export function readHeaderMonth(text: string) {
	const match = /##(\d{2})-(20\d{2})##/.exec(text);
	return match && Number(match[1]) >= 1 && Number(match[1]) <= 12 ? `${match[2]}-${match[1]}` : '';
}
