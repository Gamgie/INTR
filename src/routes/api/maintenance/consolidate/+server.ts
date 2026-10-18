import { json, type RequestHandler } from '@sveltejs/kit';

import { consolidateContract } from '$lib/server/payslipFigures';
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
export const GET: RequestHandler = async () => json({ changes: changes(await readData()) });

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
