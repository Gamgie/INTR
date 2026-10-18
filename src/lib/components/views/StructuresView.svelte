<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import CompanyEditForm from '$lib/components/CompanyEditForm.svelte';
	import CompanySummary from '$lib/components/CompanySummary.svelte';
	import DateInput from '$lib/components/DateInput.svelte';
	import { formatDate } from '$lib/format';

	let { state }: { state: IntrState } = $props();

	let selectedCompanyProjects = $derived(
		state.selectedCompanyId
			? state.appData.projects.filter((project) => project.companyId === state.selectedCompanyId)
			: []
	);

	function selectCompany(companyId: string) {
		state.selectedCompanyId = companyId;
		state.companyEditId = '';
		state.selectedProjectId =
			state.appData.projects.find((project) => project.companyId === companyId)?.id ?? '';
	}

	function addCompany() {
		state.addCompany();
	}

	function startCompanyEdit() {
		if (state.selectedCompany) state.companyEditId = state.selectedCompany.id;
	}

	function stopCompanyEdit() {
		state.companyEditId = '';
	}
</script>

<section class="view-grid two-columns">
	<section class="panel">
		<div class="panel-heading">
			<h3>Structures</h3>
			<button type="button" title="Ajouter une structure" onclick={addCompany}>+</button>
		</div>
		<div class="list compact">
			{#each state.appData.companies as company}
				<button
					type="button"
					class:selected={state.selectedCompanyId === company.id}
					onclick={() => selectCompany(company.id)}
				>
					<strong class="company-list-title">
						<span
							class="company-swatch"
							style={`--company-color: ${state.companyColor(company.id)}`}
							aria-hidden="true"
						></span>
						{company.name}
					</strong>
					<span>{company.legalName || company.email || company.siret || 'Fiche à compléter'}</span>
				</button>
			{/each}
			{#if state.appData.companies.length === 0}
				<p class="empty">Aucune structure.</p>
			{/if}
		</div>

		{#if state.selectedCompany}
			{#if state.companyEditId === state.selectedCompany.id}
				<CompanyEditForm company={state.selectedCompany} {state} onclose={stopCompanyEdit} />
			{:else}
				<CompanySummary company={state.selectedCompany} {state} onedit={startCompanyEdit} />
			{/if}
		{/if}
	</section>

	<section class="panel">
		<div class="panel-heading">
			<h3>Projets</h3>
			<button
				type="button"
				title="Ajouter un projet"
				disabled={!state.selectedCompany}
				onclick={() => state.addProject(state.selectedCompanyId)}>+</button
			>
		</div>
		<div class="list compact">
			{#each selectedCompanyProjects as project}
				<button
					type="button"
					class:selected={state.selectedProjectId === project.id}
					onclick={() => (state.selectedProjectId = project.id)}
				>
					<strong>{project.name}</strong>
					<span>{formatDate(project.startDate)}</span>
				</button>
			{/each}
			{#if !state.selectedCompany}
				<p class="empty">Sélectionne une structure.</p>
			{:else if selectedCompanyProjects.length === 0}
				<p class="empty">Aucun projet pour cette structure.</p>
			{/if}
		</div>

		{#if state.selectedProject && state.selectedProject.companyId === state.selectedCompanyId}
			<div class="form-grid tight">
				<label class="wide">
					<span>Nom du projet</span>
					<input bind:value={state.selectedProject.name} />
				</label>
				<label>
					<span>Structure</span>
					<select bind:value={state.selectedProject.companyId}>
						<option value="">Sans structure</option>
						{#each state.appData.companies as company}
							<option value={company.id}>{company.name}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Rôle</span>
					<input bind:value={state.selectedProject.role} />
				</label>
				<label>
					<span>Lieu</span>
					<input bind:value={state.selectedProject.location} />
				</label>
				<label>
					<span>Début</span>
					<DateInput bind:value={state.selectedProject.startDate} />
				</label>
				<label>
					<span>Fin</span>
					<DateInput bind:value={state.selectedProject.endDate} />
				</label>
				<label class="wide">
					<span>Notes</span>
					<textarea rows="3" bind:value={state.selectedProject.notes}></textarea>
				</label>
				<div class="button-row wide">
					<button type="button" onclick={() => state.addContract(state.selectedProject!.id)}>
						+ Contrat lié
					</button>
					<button
						class="danger"
						type="button"
						onclick={() => state.removeProject(state.selectedProject!)}
					>
						Supprimer
					</button>
				</div>
			</div>
		{/if}
	</section>
</section>
