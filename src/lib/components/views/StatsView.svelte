<script lang="ts">
	import { slide } from 'svelte/transition';

	import type { IntrState } from '$lib/app/state.svelte';
	import DocumentPresence from '$lib/components/DocumentPresence.svelte';
	import YearPicker from '$lib/components/YearPicker.svelte';
	import { requiredContractDocuments, summarizeContractDocuments } from '$lib/documentPresence';
	import { formatCurrency, formatDate, formatNumber, formatPreciseCurrency } from '$lib/format';
	import { buildMonthlyContractBreakdown, monthLabel } from '$lib/stats';
	import type { MonthlyStats } from '$lib/types';

	let { state: appState }: { state: IntrState } = $props();
	let openMonths = $state<string[]>([]);

	let visibleMonthlyStats = $derived.by(() => {
		const statsByMonth = new Map(appState.monthlyStats.map((stats) => [stats.month, stats]));
		const months = appState.timelineMonths.length
			? appState.timelineMonths
			: [...statsByMonth.keys()].sort();

		return months.map((month) => statsByMonth.get(month) ?? createEmptyMonthStats(month));
	});
	let allMonthsOpen = $derived(
		visibleMonthlyStats.length > 0 &&
			visibleMonthlyStats.every((stats) => openMonths.includes(stats.month))
	);
	let statsContracts = $derived.by(() => {
		const contractsById = new Map(
			visibleMonthlyStats.flatMap((stats) =>
				monthContracts(stats.month).map(({ contract }) => [contract.id, contract] as const)
			)
		);

		return [...contractsById.values()];
	});
	let documentSummary = $derived(
		summarizeContractDocuments(statsContracts, appState.appData.documents)
	);

	function createEmptyMonthStats(month: string): MonthlyStats {
		return {
			month,
			label: monthLabel(month),
			hours: 0,
			cachets: 0,
			netSalary: 0,
			taxableNetSalary: 0,
			grossSalary: 0,
			contributions: 0,
			contributionRate: 0,
			netHourlyRate: 0,
			grossHourlyRate: 0,
			contractCount: 0,
			workedDaysEstimate: 0,
			estimatedDailyAllowance: 0,
			estimatedIndemnity: 0,
			realIndemnity: 0,
			congeSpectacle: 0,
			totalIncomeEstimated: 0,
			totalIncomeReal: 0
		};
	}

	function isMonthOpen(month: string) {
		return openMonths.includes(month);
	}

	function toggleMonth(month: string) {
		appState.selectMonth(month);
		openMonths = isMonthOpen(month)
			? openMonths.filter((item) => item !== month)
			: [...openMonths, month];
	}

	function toggleAllMonths() {
		openMonths = allMonthsOpen ? [] : visibleMonthlyStats.map((stats) => stats.month);
	}

	function monthContracts(month: string) {
		return buildMonthlyContractBreakdown(appState.appData, month);
	}

	function openContract(contractId: string) {
		appState.selectedContractId = contractId;
		appState.activeTab = 'contrats';
	}
</script>

<section class="panel">
	<div class="panel-heading">
		<h3>Statistiques mensuelles</h3>
		<div class="stats-actions">
			<YearPicker state={appState} />
			<button type="button" onclick={toggleAllMonths} disabled={visibleMonthlyStats.length === 0}>
				{allMonthsOpen ? 'Replier tout' : 'Déplier tout'}
			</button>
		</div>
	</div>

	<div class="month-focus">
		<div>
			<span>Heures</span>
			<strong>{formatNumber(appState.periodStats.hours, 0)} h</strong>
		</div>
		<div>
			<span>Salaire net</span>
			<strong>{formatCurrency(appState.periodStats.netSalary)}</strong>
		</div>
		<div>
			<span>ARE réelle</span>
			<strong>{formatCurrency(appState.periodStats.realIndemnity)}</strong>
		</div>
		<div>
			<span>Total réel</span>
			<strong>{formatCurrency(appState.periodStats.totalIncomeReal)}</strong>
		</div>
	</div>

	<div
		class="document-completeness"
		class:complete={documentSummary.totalContracts > 0 && documentSummary.incompleteContracts === 0}
		class:incomplete={documentSummary.incompleteContracts > 0}
	>
		{#if documentSummary.totalContracts === 0}
			<span class="document-completeness-mark" aria-hidden="true">–</span>
			<span>Aucun contrat à contrôler sur cette période.</span>
		{:else if documentSummary.incompleteContracts === 0}
			<span class="document-completeness-mark" aria-hidden="true">✓</span>
			<span>
				{documentSummary.totalContracts === 1
					? 'Tous les documents existent pour le contrat de la période.'
					: `Tous les documents existent pour les ${documentSummary.totalContracts} contrats de la période.`}
			</span>
		{:else}
			<span class="document-completeness-mark" aria-hidden="true">!</span>
			<span>
				Documents manquants pour {documentSummary.incompleteContracts} contrat{documentSummary.incompleteContracts >
				1
					? 's'
					: ''} sur {documentSummary.totalContracts} :
				{requiredContractDocuments
					.filter(({ kind }) => documentSummary.missingByKind[kind] > 0)
					.map(({ kind, shortLabel }) => `${shortLabel} × ${documentSummary.missingByKind[kind]}`)
					.join(' · ')}.
			</span>
		{/if}
	</div>

	<div class="table-wrap tall">
		<table>
			<thead>
				<tr>
					<th>Mois</th>
					<th>Heures</th>
					<th>Cachets</th>
					<th>Contrats</th>
					<th>Net</th>
					<th>Brut</th>
					<th>Cot.</th>
					<th>% Cot.</th>
					<th>Taux net</th>
					<th>AJ</th>
					<th>Indem. réelle</th>
					<th>Total réel</th>
				</tr>
			</thead>
			<tbody>
				{#each visibleMonthlyStats as stats}
					<tr
						class:selected={appState.selectedMonth === stats.month}
						class:open={isMonthOpen(stats.month)}
						class:has-contracts={stats.contractCount > 0}
						onclick={() => toggleMonth(stats.month)}
					>
						<td>
							<span class="month-label">{stats.label}</span>
						</td>
						<td>{formatNumber(stats.hours, 0)}</td>
						<td>{formatNumber(stats.cachets, 0)}</td>
						<td>{formatNumber(stats.contractCount, 0)}</td>
						<td>{formatCurrency(stats.netSalary)}</td>
						<td>{formatCurrency(stats.grossSalary)}</td>
						<td>{formatCurrency(stats.contributions)}</td>
						<td>{formatNumber(stats.contributionRate, 1)} %</td>
						<td>{formatPreciseCurrency(stats.netHourlyRate)}</td>
						<td>{formatPreciseCurrency(stats.estimatedDailyAllowance)}</td>
						<td>{formatCurrency(stats.realIndemnity)}</td>
						<td>{formatCurrency(stats.totalIncomeReal)}</td>
					</tr>
					{#if isMonthOpen(stats.month)}
						{@const contracts = monthContracts(stats.month)}
						<tr class="month-detail-row">
							<td colspan="12">
								<div class="month-contracts" transition:slide={{ duration: 160 }}>
									{#if contracts.length > 0}
										<table class="nested-table">
											<colgroup>
												<col class="contract-col-title" />
												<col class="contract-col-structure" />
												<col class="contract-col-project" />
												<col class="contract-col-period" />
												<col class="contract-col-hours" />
												<col class="contract-col-money" />
												<col class="contract-col-money" />
												<col class="contract-col-money" />
												<col class="contract-col-status" />
												<col class="contract-col-documents" />
											</colgroup>
											<thead>
												<tr>
													<th>Contrat</th>
													<th>Structure</th>
													<th>Projet</th>
													<th>Période</th>
													<th>Heures mois</th>
													<th>Net mois</th>
													<th>Brut mois</th>
													<th>Cot.</th>
													<th>Statut</th>
													<th>Documents</th>
												</tr>
											</thead>
											<tbody>
												{#each contracts as detail (detail.contract.id)}
													<tr
														class:clickable={true}
														onclick={() => openContract(detail.contract.id)}
													>
														<td>{detail.contract.title}</td>
														<td>{appState.companyName(detail.contract.companyId)}</td>
														<td>{appState.projectName(detail.contract.projectId)}</td>
														<td>
															{formatDate(detail.contract.startDate)} - {formatDate(
																detail.contract.endDate
															)}
														</td>
														<td>{formatNumber(detail.hours, 0)}</td>
														<td>{formatCurrency(detail.netSalary)}</td>
														<td>{formatCurrency(detail.grossSalary)}</td>
														<td>{formatCurrency(detail.contributions)}</td>
														<td>
															<span class="status" data-status={detail.contract.status}>
																{detail.contract.status}
															</span>
														</td>
														<td>
															<DocumentPresence
																documents={appState.documentsFor(detail.contract)}
															/>
														</td>
													</tr>
												{/each}
											</tbody>
										</table>
									{:else}
										<p class="empty">Aucun contrat sur ce mois.</p>
									{/if}
								</div>
							</td>
						</tr>
					{/if}
				{/each}
				{#if visibleMonthlyStats.length === 0}
					<tr>
						<td colspan="12" class="empty">Aucune donnée mensuelle.</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</section>
