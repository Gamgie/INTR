import { json, type RequestHandler } from '@sveltejs/kit';

import { normalizeCompanyColor } from '$lib/companyColors';
import { buildEmployerDirectory, employerName, normalize, readEmployer, sirets } from '$lib/employer';
import { searchCompanies } from '$lib/server/companySearch';
import { createId, mutateData, readData } from '$lib/server/storage';
import type { AppData, Company, CompanySearchResult } from '$lib/types';

type Group = { key: string; siren: string; siret: string; name: string; contractIds: string[] };

// Employeur de chaque contrat sans structure, lu dans ses documents (SIREN d'abord, sinon nom),
// regroupé par employeur.
function plan(data: AppData) {
	const readings = new Map(data.documents.map((document) => [document.id, readEmployer(document.extractedTextPreview ?? '')]));
	const directory = buildEmployerDirectory(
		[...readings.values()].filter((reading) => reading !== undefined),
		{},
		data.companies
	);
	const groups = new Map<string, Group>();
	const unknown: string[] = [];

	for (const contract of data.contracts) {
		if (contract.companyId) continue;
		const documents = data.documents.filter((document) => contract.documentIds.includes(document.id));
		const votes = new Map<string, number>();
		for (const document of documents) {
			const siren = readings.get(document.id)?.siren ?? '';
			if (siren.length === 9) votes.set(siren, (votes.get(siren) ?? 0) + 1);
		}
		const siren = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
		const name =
			(siren && directory.bySiren.get(siren)) ||
			documents.map((document) => employerName(readings.get(document.id), directory)).find(Boolean) ||
			'';
		if (!siren && !name) {
			unknown.push(contract.id);
			continue;
		}
		const key = siren || `nom:${normalize(name)}`;
		const group = groups.get(key) ?? { key, siren, siret: '', name, contractIds: [] };
		group.contractIds.push(contract.id);
		if (siren && !group.siret) {
			const text = documents.map((document) => document.extractedTextPreview).join(' ');
			group.siret = sirets(text).find((value) => value.startsWith(siren)) ?? '';
		}
		groups.set(key, group);
	}
	return { groups: [...groups.values()], unknown };
}

function findCompany(companies: Company[], group: Group) {
	return companies.find(
		(company) =>
			(group.siren && (company.siren === group.siren || company.siret.startsWith(group.siren))) ||
			(!group.siren && normalize(company.name) === normalize(group.name))
	);
}

function newCompany(group: Group, result: CompanySearchResult | undefined): Company {
	const id = createId('company');
	const name = group.name || result?.name || 'Structure importée';
	return {
		id,
		name,
		legalName: result?.legalName ?? '',
		contactName: '',
		email: '',
		phone: '',
		address: result?.address ?? '',
		postalCode: result?.postalCode ?? '',
		city: result?.city ?? '',
		siren: result?.siren || group.siren,
		siret: group.siret || result?.siret || '',
		ape: result?.ape ?? '',
		legalCategory: result?.legalCategory ?? '',
		activityLabel: result?.activityLabel ?? '',
		color: normalizeCompanyColor('', `${id}:${name}`),
		source: result?.sourceUrl ?? '',
		sourceUpdatedAt: result?.sourceUpdatedAt ?? '',
		notes: result
			? 'Structure créée depuis le SIREN lu dans les documents, fiche de l’annuaire des entreprises.'
			: 'Structure créée depuis les documents (pas de fiche trouvée dans l’annuaire des entreprises).'
	};
}

// GET : les structures qui seraient créées ou rattachées. POST : crée les structures (fiche de
// l'annuaire des entreprises quand le SIREN est connu) et les rattache aux contrats sans structure.
export const GET: RequestHandler = async () => {
	const data = await readData();
	const { groups, unknown } = plan(data);
	return json({
		groups: groups.map((group) => ({
			...group,
			existing: findCompany(data.companies, group)?.name ?? '',
			contracts: group.contractIds.length
		})),
		unknown: unknown.length
	});
};

export const POST: RequestHandler = async ({ fetch }) => {
	const { groups } = plan(await readData());
	const lookups = new Map<string, CompanySearchResult | undefined>();
	for (const group of groups) {
		if (!group.siren) continue;
		try {
			const results = await searchCompanies(group.siret || group.siren, fetch, 3);
			lookups.set(group.key, results.find((result) => result.siren === group.siren));
		} catch {
			lookups.set(group.key, undefined);
		}
	}

	const report: { name: string; created: boolean; contracts: number; registry: boolean }[] = [];
	const data = await mutateData((current) => {
		const now = new Date().toISOString();
		for (const group of groups) {
			let company = findCompany(current.companies, group);
			const created = !company;
			if (!company) {
				company = newCompany(group, lookups.get(group.key));
				current.companies.push(company);
			}
			let linked = 0;
			for (const contract of current.contracts) {
				if (!group.contractIds.includes(contract.id) || contract.companyId) continue;
				contract.companyId = company.id;
				contract.updatedAt = now;
				linked += 1;
			}
			report.push({ name: company.name, created, contracts: linked, registry: Boolean(lookups.get(group.key)) });
		}
	});
	return json({ report, companies: data.companies.length });
};
