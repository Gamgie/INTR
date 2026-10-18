import { json, type RequestHandler } from '@sveltejs/kit';

import { buildEmployerDirectory, employerName, readEmployer } from '$lib/employer';
import { consolidateContract, readFigures } from '$lib/server/payslipFigures';
import { mutateData, readData } from '$lib/server/storage';
import type { AppData, ContractFields } from '$lib/types';

type Change = {
	id: string;
	title: string;
	before: Partial<ContractFields>;
	after: Partial<ContractFields>;
	sources: string[];
};

function changes(data: AppData) {
	const list: Change[] = [];
	for (const contract of data.contracts) {
		const { fields, sources } = consolidateContract(contract, data.documents);
		const keys = Object.keys(fields) as (keyof ContractFields)[];
		if (!keys.length) continue;
		list.push({
			id: contract.id,
			title: contract.title,
			before: Object.fromEntries(keys.map((key) => [key, contract[key]])),
			after: fields,
			sources
		});
	}
	return list;
}

// GET : ce que le recalcul des contrats changerait (heures, cachets, brut, net payé, dates),
// sans rien écrire. POST : applique ce recalcul, en une seule écriture.
export const GET: RequestHandler = async ({ url }) => {
	const data = await readData();
	if (url.searchParams.get('vue') !== 'paies') return json({ changes: changes(data) });

	// ?vue=paies : chaque contrat avec l'employeur lu dans ses documents et chacun de ses
	// bulletins, pour le comparer au classeur de déclaration.
	const readings = new Map(data.documents.map((document) => [document.id, readEmployer(document.extractedTextPreview ?? '')]));
	const directory = buildEmployerDirectory(
		[...readings.values()].filter((reading) => reading !== undefined),
		{},
		data.companies
	);
	return json({
		contracts: data.contracts.map((contract) => {
			const documents = data.documents.filter((document) => contract.documentIds.includes(document.id));
			const company = data.companies.find((item) => item.id === contract.companyId);
			return {
				id: contract.id,
				title: contract.title,
				start: contract.startDate,
				end: contract.endDate,
				hours: contract.hours,
				cachets: contract.cachets,
				gross: contract.grossSalary,
				net: contract.netSalary,
				status: contract.status,
				employer:
					company?.name ||
					documents.map((document) => employerName(readings.get(document.id), directory)).find(Boolean) ||
					'',
				docs: documents.map((document) => `${document.kind}: ${document.fileName}`),
				payslips: documents
					.filter((document) => document.kind === 'Fiche de paie')
					.map((document) => readFigures(document.extractedTextPreview, document.kind))
					.filter(Boolean)
			};
		})
	});
};

export const POST: RequestHandler = async () => {
	let applied: Change[] = [];
	await mutateData((current) => {
		applied = changes(current);
		const now = new Date().toISOString();
		for (const change of applied) {
			const contract = current.contracts.find((item) => item.id === change.id);
			if (!contract) continue;
			Object.assign(contract, change.after);
			contract.updatedAt = now;
		}
	});
	return json({ applied: applied.length, changes: applied });
};
