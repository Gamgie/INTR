<script lang="ts">
	import { base } from '$app/paths';

	import type { IntrState } from '$lib/app/state.svelte';
	import type { Company, CompanySearchResult } from '$lib/types';

	let { company, state: app }: { company: Company; state: IntrState } = $props();
	let currentCompanyId = $state('');
	let query = $state('');
	let results = $state<CompanySearchResult[]>([]);
	let status = $state<'idle' | 'searching' | 'done' | 'error'>('idle');

	$effect(() => {
		if (company.id !== currentCompanyId) {
			currentCompanyId = company.id;
			query = company.name;
			results = [];
			status = 'idle';
		}
	});

	async function searchCompany() {
		const cleaned = query.trim();
		if (cleaned.length < 2) return;

		status = 'searching';
		const params = new URLSearchParams({ q: cleaned });

		try {
			const response = await fetch(`${base}/api/companies/search?${params.toString()}`);
			if (!response.ok) {
				status = 'error';
				results = [];
				return;
			}

			const payload = (await response.json()) as { results: CompanySearchResult[] };
			results = payload.results;
			status = 'done';
		} catch {
			status = 'error';
			results = [];
		}
	}
</script>

<section class="search-box">
	<div class="panel-heading">
		<h4>Recherche officielle</h4>
		<span class="search-meta">API Recherche d’Entreprises</span>
	</div>
	<div class="search-actions">
		<input
			aria-label="Nom de compagnie à rechercher"
			placeholder="Nom de compagnie, association, SIREN, SIRET..."
			bind:value={query}
			oninput={(event) => event.stopPropagation()}
			onchange={(event) => event.stopPropagation()}
			onkeydown={(event) => {
				if (event.key === 'Enter') searchCompany();
			}}
		/>
		<button type="button" onclick={searchCompany} disabled={status === 'searching'}>
			{status === 'searching' ? 'Recherche...' : 'Chercher'}
		</button>
	</div>

	{#if status === 'error'}
		<p class="analysis-note">La recherche est indisponible pour le moment.</p>
	{:else if status === 'done' && results.length === 0}
		<p class="empty">Aucun résultat fiable trouvé.</p>
	{/if}

	<div class="search-results">
		{#each results as result}
			<article class="search-result">
				<span class="search-result-main">
					<strong>{result.name}</strong>
					<span>{result.address || 'Adresse non disponible'}</span>
					<span class="search-meta">
						SIRET {result.siret || '-'} · {result.activityLabel || 'APE non renseigné'}
						{#if result.isEntrepreneurSpectacle}
							· entrepreneur spectacle
						{/if}
					</span>
				</span>
				<span class="score-pill">{result.score}%</span>
				<div class="search-result-actions">
					<button type="button" onclick={() => app.applyCompanySearchResult(company, result)}>
						Utiliser
					</button>
					{#if result.sourceUrl}
						<a href={result.sourceUrl} target="_blank" rel="noreferrer">Vérifier</a>
					{/if}
				</div>
			</article>
		{/each}
	</div>
</section>
