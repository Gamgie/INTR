<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import { formatCurrency, formatDate, formatNumber } from '$lib/format';
	import type { Company } from '$lib/types';

	let {
		company,
		state,
		onedit
	}: { company: Company; state: IntrState; onedit: () => void } = $props();

	let projects = $derived(
		state.appData.projects.filter((project) => project.companyId === company.id)
	);
	let contracts = $derived(
		state.appData.contracts.filter(
			(contract) =>
				contract.companyId === company.id ||
				projects.some((project) => project.id === contract.projectId)
		)
	);
	let totalHours = $derived(contracts.reduce((total, contract) => total + contract.hours, 0));
	let totalNet = $derived(contracts.reduce((total, contract) => total + contract.netSalary, 0));
	let totalGross = $derived(contracts.reduce((total, contract) => total + contract.grossSalary, 0));

	function valueOrDash(value: string) {
		return value.trim() || '-';
	}
</script>

<section class="structure-profile">
	<div class="profile-heading">
		<div class="profile-title">
			<span
				class="company-swatch"
				style={`--company-color: ${state.companyColor(company.id)}`}
				aria-hidden="true"
			></span>
			<div>
				<h4>{company.name}</h4>
				<span>{company.legalName || company.activityLabel || 'Fiche structure'}</span>
			</div>
		</div>
		<div class="profile-actions">
			{#if company.source}
				<a class="ghost-button" href={company.source} target="_blank" rel="noreferrer">Vérifier</a>
			{/if}
			<button type="button" onclick={onedit}>Modifier</button>
		</div>
	</div>

	<div class="structure-stats">
		<div>
			<span>Contrats</span>
			<strong>{contracts.length}</strong>
		</div>
		<div>
			<span>Heures</span>
			<strong>{formatNumber(totalHours, 0)} h</strong>
		</div>
		<div>
			<span>Net / Brut</span>
			<strong>{formatCurrency(totalNet)} / {formatCurrency(totalGross)}</strong>
		</div>
	</div>

	<div class="info-grid">
		<div class="info-item">
			<span>SIRET</span>
			<strong>{valueOrDash(company.siret)}</strong>
		</div>
		<div class="info-item">
			<span>SIREN</span>
			<strong>{valueOrDash(company.siren)}</strong>
		</div>
		<div class="info-item">
			<span>APE</span>
			<strong>{valueOrDash(company.ape)}</strong>
		</div>
		<div class="info-item">
			<span>Ville</span>
			<strong>{valueOrDash([company.postalCode, company.city].filter(Boolean).join(' '))}</strong>
		</div>
		<div class="info-item">
			<span>Contact</span>
			<strong>{valueOrDash(company.contactName)}</strong>
		</div>
		<div class="info-item">
			<span>Email</span>
			<strong>{valueOrDash(company.email)}</strong>
		</div>
		<div class="info-item">
			<span>Téléphone</span>
			<strong>{valueOrDash(company.phone)}</strong>
		</div>
		<div class="info-item">
			<span>Catégorie</span>
			<strong>{valueOrDash(company.legalCategory)}</strong>
		</div>
		<div class="info-item full">
			<span>Activité</span>
			<strong>{valueOrDash(company.activityLabel)}</strong>
		</div>
		<div class="info-item full">
			<span>Adresse</span>
			<strong>{valueOrDash(company.address)}</strong>
		</div>
		{#if company.notes}
			<div class="info-item full">
				<span>Notes</span>
				<strong>{company.notes}</strong>
			</div>
		{/if}
	</div>

	{#if projects.length}
		<div class="related-list">
			<h4>Projets liés</h4>
			{#each projects.slice(0, 5) as project}
				<button type="button" onclick={() => (state.selectedProjectId = project.id)}>
					<strong>{project.name}</strong>
					<span>{project.role || project.location || formatDate(project.startDate)}</span>
				</button>
			{/each}
		</div>
	{/if}
</section>
