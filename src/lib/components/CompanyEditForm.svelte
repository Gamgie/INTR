<script lang="ts">
	import type { IntrState } from '$lib/app/state.svelte';
	import CompanySearch from '$lib/components/CompanySearch.svelte';
	import type { Company } from '$lib/types';

	let {
		company,
		state,
		onclose
	}: { company: Company; state: IntrState; onclose: () => void } = $props();

	function removeCompany() {
		state.removeCompany(company);
		onclose();
	}
</script>

<CompanySearch {company} {state} />

<div class="form-grid tight">
	<label class="wide">
		<span>Nom</span>
		<input bind:value={company.name} />
	</label>
	<label class="wide">
		<span>Raison sociale</span>
		<input bind:value={company.legalName} />
	</label>
	<label>
		<span>Couleur</span>
		<div class="color-field">
			<input type="color" bind:value={company.color} />
			<input bind:value={company.color} />
		</div>
	</label>
	<label>
		<span>Contact</span>
		<input bind:value={company.contactName} />
	</label>
	<label>
		<span>Email</span>
		<input type="email" bind:value={company.email} />
	</label>
	<label>
		<span>Téléphone</span>
		<input bind:value={company.phone} />
	</label>
	<label>
		<span>SIREN</span>
		<input bind:value={company.siren} />
	</label>
	<label>
		<span>SIRET</span>
		<input bind:value={company.siret} />
	</label>
	<label>
		<span>APE</span>
		<input bind:value={company.ape} />
	</label>
	<label>
		<span>Ville</span>
		<input bind:value={company.city} />
	</label>
	<label>
		<span>Code postal</span>
		<input bind:value={company.postalCode} />
	</label>
	<label>
		<span>Catégorie juridique</span>
		<input bind:value={company.legalCategory} />
	</label>
	<label>
		<span>Activité</span>
		<input bind:value={company.activityLabel} />
	</label>
	<label class="wide">
		<span>Adresse</span>
		<textarea rows="2" bind:value={company.address}></textarea>
	</label>
	<label class="wide">
		<span>Source</span>
		<input bind:value={company.source} />
	</label>
	<label class="wide">
		<span>Notes</span>
		<textarea rows="3" bind:value={company.notes}></textarea>
	</label>
	<div class="button-row wide">
		<button class="primary" type="button" onclick={onclose}>Terminer</button>
		<button class="danger" type="button" onclick={removeCompany}>Supprimer la structure</button>
	</div>
</div>
