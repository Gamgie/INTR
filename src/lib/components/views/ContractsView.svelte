<script lang="ts">
	import { statuses, type IntrState } from '$lib/app/state.svelte';
	import DateInput from '$lib/components/DateInput.svelte';
	import DocumentList from '$lib/components/DocumentList.svelte';
	import DocumentPresence from '$lib/components/DocumentPresence.svelte';
	import ImportFeedback from '$lib/components/ImportFeedback.svelte';
	import { formatCurrency, formatDate, formatNumber } from '$lib/format';
	import type { Contract, IntermittencePeriod } from '$lib/types';

	let { state: appState }: { state: IntrState } = $props();
	let selectedContractsPeriodKey = $state('all');

	let contractCalendarYears = $derived(
		[
			...new Set(
				appState.appData.contracts
					.map((contract) => contractYear(contract))
					.filter((year) => year.length > 0)
			)
		].sort((a, b) => Number(b) - Number(a))
	);

	let displayedContracts = $derived(
		[...appState.appData.contracts]
			.filter((contract) => contractMatchesSelectedPeriod(contract))
			.sort(compareContractsRecentFirst)
	);

	let availableProjectsForSelectedContract = $derived(
		appState.selectedContract
			? appState.appData.projects.filter(
					(project) => project.companyId === appState.selectedContract!.companyId
				)
			: []
	);

	$effect(() => {
		if (!appState.selectedContractId) {
			appState.selectedContractId = displayedContracts[0]?.id ?? '';
		} else if (
			!displayedContracts.some((contract) => contract.id === appState.selectedContractId)
		) {
			appState.selectedContractId = displayedContracts[0]?.id ?? '';
		}
	});

	function parseDate(value: string) {
		const date = new Date(`${value}T00:00:00`);
		return Number.isNaN(date.getTime()) ? undefined : date;
	}

	function contractSortKey(contract: Contract) {
		return contract.startDate || contract.endDate || contract.createdAt || '';
	}

	function compareContractsRecentFirst(left: Contract, right: Contract) {
		return (
			contractSortKey(right).localeCompare(contractSortKey(left)) ||
			(right.createdAt || '').localeCompare(left.createdAt || '')
		);
	}

	function contractYear(contract: Contract) {
		return (contract.startDate || contract.endDate || contract.createdAt || '').slice(0, 4);
	}

	function periodStart(period: IntermittencePeriod) {
		return parseDate(period.indemnizationStartDate || period.referenceStartDate);
	}

	function periodEnd(period: IntermittencePeriod) {
		return parseDate(period.anniversaryDate || period.referenceEndDate);
	}

	function isContractInsidePeriod(contract: Contract, period: IntermittencePeriod) {
		const start = parseDate(contract.startDate);
		if (!start) return false;

		const end = parseDate(contract.endDate) ?? start;
		const startLimit = periodStart(period);
		const endLimit = periodEnd(period);

		return (!endLimit || start <= endLimit) && (!startLimit || end >= startLimit);
	}

	function contractMatchesSelectedPeriod(contract: Contract) {
		if (selectedContractsPeriodKey === 'all') return true;

		if (selectedContractsPeriodKey.startsWith('year:')) {
			return contractYear(contract) === selectedContractsPeriodKey.slice(5);
		}

		const periodId = selectedContractsPeriodKey.replace(/^period:/, '');
		const period = appState.appData.periods.find((item) => item.id === periodId);
		return period ? isContractInsidePeriod(contract, period) : true;
	}

	function updateSelectedContractCompany(companyId: string) {
		const contract = appState.selectedContract;
		if (!contract) return;

		contract.companyId = companyId;
		const currentProject = appState.appData.projects.find(
			(project) => project.id === contract.projectId
		);
		if (currentProject && currentProject.companyId !== companyId) {
			contract.projectId = '';
		}
		contract.updatedAt = new Date().toISOString();
	}

	// Une saisie à la main protège le champ du recalcul automatique depuis les documents.
	function markManual(field: string) {
		const contract = appState.selectedContract;
		if (!contract) return;
		contract.manualFields = [...new Set([...(contract.manualFields ?? []), field])];
	}
</script>

<section class="view-grid contract-layout">
	<section class="panel list-panel">
		<div class="panel-heading">
			<h3>Contrats</h3>
			<div class="button-row">
				<label class="compact-select">
					<span>Année</span>
					<select bind:value={selectedContractsPeriodKey}>
						<option value="all">Toutes</option>
						{#if appState.appData.periods.length}
							<optgroup label="Intermittence">
								{#each appState.appData.periods as period}
									<option value={`period:${period.id}`}>{period.label}</option>
								{/each}
							</optgroup>
						{/if}
						{#if contractCalendarYears.length}
							<optgroup label="Civile">
								{#each contractCalendarYears as year}
									<option value={`year:${year}`}>{year}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
				</label>
				<label class="file-button" title="Importer et ranger automatiquement des documents">
					Importer
					<input
						type="file"
						multiple
						accept=".pdf,.txt,.csv,.md,application/pdf,text/*"
						onchange={(event) => {
							event.stopPropagation();
							appState.createContractFromDocument(event);
						}}
					/>
				</label>
				<button type="button" title="Ajouter un contrat" onclick={() => appState.addContract()}
					>+</button
				>
			</div>
		</div>
		<ImportFeedback state={appState} />
		{#if appState.companySuggestionState.length}
			<div class="suggestion-stack">
				{#each appState.companySuggestionState as suggestion}
					<article class="company-suggestion">
						<div>
							<strong>{suggestion.result.name}</strong>
							<span>
								SIRET {suggestion.result.siret || suggestion.siret} ·
								{suggestion.result.city || 'ville non renseignée'}
							</span>
							<span>{suggestion.result.address || 'Adresse non disponible'}</span>
						</div>
						<div class="search-result-actions">
							<button type="button" onclick={() => appState.applyCompanySuggestion(suggestion)}>
								Ajouter et lier
							</button>
							{#if suggestion.result.sourceUrl}
								<a href={suggestion.result.sourceUrl} target="_blank" rel="noreferrer">Vérifier</a>
							{/if}
							<button type="button" onclick={() => appState.dismissCompanySuggestion(suggestion)}>
								Ignorer
							</button>
						</div>
					</article>
				{/each}
			</div>
		{/if}
		<div class="list">
			{#each displayedContracts as contract}
				<button
					type="button"
					class:selected={appState.selectedContractId === contract.id}
					onclick={() => (appState.selectedContractId = contract.id)}
				>
					<strong class="company-list-title">
						<span
							class="company-swatch"
							style={`--company-color: ${appState.companyColor(contract.companyId)}`}
							aria-hidden="true"
						></span>
						{contract.title}
					</strong>
					<span>
						{appState.companyName(contract.companyId)} · {appState.projectName(contract.projectId)} ·
						{formatDate(contract.startDate)}
					</span>
					<div class="contract-list-footer">
						<i>
							{#if contract.netSalary > 0}
								{formatCurrency(contract.netSalary)} net
							{:else if contract.grossSalary > 0}
								{formatCurrency(contract.grossSalary)} brut
							{:else}
								Salaire non renseigné
							{/if}
							· {formatNumber(contract.hours, 0)} h
						</i>
						<DocumentPresence documents={appState.documentsFor(contract)} />
					</div>
				</button>
			{/each}
			{#if displayedContracts.length === 0}
				<p class="empty">
					{appState.appData.contracts.length === 0
						? 'Ajoute un contrat pour commencer.'
						: 'Aucun contrat pour cette année.'}
				</p>
			{/if}
		</div>
	</section>

	<section class="panel detail-panel">
		{#if appState.selectedContract}
			<div class="panel-heading">
				<h3>{appState.selectedContract.title}</h3>
				<button
					class="danger"
					type="button"
					title="Supprimer le contrat"
					onclick={() => appState.removeContract(appState.selectedContract!)}
				>
					Supprimer
				</button>
			</div>

			<div class="status-row">
				{#each statuses as status}
					<button
						type="button"
						class:active={appState.selectedContract.status === status}
						onclick={() => appState.setStatus(appState.selectedContract!, status)}
					>
						{status}
					</button>
				{/each}
			</div>

			<div class="form-grid">
				<label class="wide">
					<span>Intitulé</span>
					<input bind:value={appState.selectedContract.title} />
				</label>
				<label>
					<span>Structure</span>
					<select
						value={appState.selectedContract.companyId}
						onchange={(event) => updateSelectedContractCompany(event.currentTarget.value)}
					>
						<option value="">Sans structure</option>
						{#each appState.appData.companies as company}
							<option value={company.id}>{company.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Projet</span>
					<select bind:value={appState.selectedContract.projectId}>
						<option value="">Sans projet</option>
						{#each availableProjectsForSelectedContract as project}
							<option value={project.id}>{project.name}</option>
						{/each}
					</select>
				</label>
				<label onchange={() => markManual('startDate')}>
					<span>Début</span>
					<DateInput bind:value={appState.selectedContract.startDate} />
				</label>
				<label onchange={() => markManual('endDate')}>
					<span>Fin</span>
					<DateInput bind:value={appState.selectedContract.endDate} />
				</label>
				<label onchange={() => markManual('hours')}>
					<span>Heures</span>
					<input
						type="number"
						min="0"
						step="0.25"
						bind:value={appState.selectedContract.hours}
						onchange={() => appState.updateRates(appState.selectedContract!)}
					/>
				</label>
				<label onchange={() => markManual('cachets')}>
					<span>Cachets</span>
					<input type="number" min="0" step="1" bind:value={appState.selectedContract.cachets} />
				</label>
				<label onchange={() => markManual('employmentStatus')}>
					<span>Statut metier</span>
					<input bind:value={appState.selectedContract.employmentStatus} />
				</label>
				<label onchange={() => markManual('netSalary')}>
					<span>Net</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.netSalary}
						onchange={() => appState.updateRates(appState.selectedContract!)}
					/>
				</label>
				<label>
					<span>Net imposable</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.taxableNetSalary}
					/>
				</label>
				<label onchange={() => markManual('grossSalary')}>
					<span>Brut</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.grossSalary}
						onchange={() => appState.updateRates(appState.selectedContract!)}
					/>
				</label>
				<label>
					<span>Cotisations</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.contributions}
					/>
				</label>
				<label onchange={() => markManual('employerCost')}>
					<span>Coût employeur</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.employerCost}
					/>
				</label>
				<label>
					<span>Taux net</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.netHourlyRate}
					/>
				</label>
				<label>
					<span>Taux brut</span>
					<input
						type="number"
						min="0"
						step="0.01"
						bind:value={appState.selectedContract.grossHourlyRate}
					/>
				</label>
				<label class="wide">
					<span>Notes</span>
					<textarea rows="3" bind:value={appState.selectedContract.notes}></textarea>
				</label>
			</div>

			<DocumentList contract={appState.selectedContract} state={appState} />
		{:else}
			<div class="empty-state">
				<h3>Aucun contrat</h3>
				<button class="primary" type="button" onclick={() => appState.addContract()}>
					Créer un contrat
				</button>
			</div>
		{/if}
	</section>
</section>
