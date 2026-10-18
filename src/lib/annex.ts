// Annexe de chaque contrat, d'après l'emploi déclaré par l'employeur (AEM, bulletin) :
// artistes → annexe 10, ouvriers et techniciens → annexe 8.
import type { Annex } from '$lib/rules';
import { contractRecognizedHours } from '$lib/stats';
import type { Contract } from '$lib/types';

const squash = (value: string) =>
	value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/[^a-z]/g, '');

const TECHNICIAN = ['technicien', 'regisseu', 'ouvrier', 'conseillertechnique', 'machiniste', 'eclairagiste', 'monteur', 'cadreur', 'operateur', 'ingenieurduson', 'sonorisateur', 'constructeur'];
const ARTIST = ['artiste', 'clown', 'comedien', 'danseu', 'musicien', 'chanteu', 'vj', 'videojockey', 'videojokey', 'circassien', 'marionnettiste', 'acteur', 'performeur', 'performer'];

/** Annexe d'un contrat d'après son emploi, ou '' si l'emploi ne permet pas de trancher. */
export function contractAnnex(contract: Pick<Contract, 'employmentStatus'>): Annex | '' {
	const status = squash(contract.employmentStatus ?? '');
	if (!status) return '';
	if (TECHNICIAN.some((word) => status.includes(word))) return 'Annexe 8';
	if (ARTIST.some((word) => status.includes(word))) return 'Annexe 10';
	return '';
}

export type AnnexSplit = {
	annex8: number;
	annex10: number;
	unknown: number;
	/** Annexe du dernier contrat (par date de fin) dont l'emploi est connu. */
	lastAnnex: Annex | '';
	/** Annexe qui a le plus d'heures. */
	majority: Annex | '';
};

export function annexSplit(contracts: Contract[]): AnnexSplit {
	const split: AnnexSplit = { annex8: 0, annex10: 0, unknown: 0, lastAnnex: '', majority: '' };
	let lastEnd = '';
	for (const contract of contracts) {
		const hours = contractRecognizedHours(contract);
		const annex = contractAnnex(contract);
		if (annex === 'Annexe 8') split.annex8 += hours;
		else if (annex === 'Annexe 10') split.annex10 += hours;
		else split.unknown += hours;
		const end = contract.endDate || contract.startDate;
		if (annex && end && end >= lastEnd) {
			lastEnd = end;
			split.lastAnnex = annex;
		}
	}
	if (split.annex8 || split.annex10) split.majority = split.annex10 >= split.annex8 ? 'Annexe 10' : 'Annexe 8';
	split.annex8 = Math.round(split.annex8 * 100) / 100;
	split.annex10 = Math.round(split.annex10 * 100) / 100;
	split.unknown = Math.round(split.unknown * 100) / 100;
	return split;
}
