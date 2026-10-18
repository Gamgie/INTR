<script lang="ts">
	import { untrack } from 'svelte';

	import { afterNavigate, pushState, replaceState } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import ServerStatus from '$lib/components/ServerStatus.svelte';
	import type { IntrState, Tab } from '$lib/app/state.svelte';
	import { tabs } from '$lib/app/state.svelte';

	let { state: app, children }: { state: IntrState; children: import('svelte').Snippet } =
		$props();

	const autoSaveDelayMs = 900;
	const deployedAtLabel = new Intl.DateTimeFormat('fr-FR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Paris'
	}).format(new Date(__DEPLOYED_AT__));

	$effect(() => {
		const revision = app.changeRevision;

		if (!app.dirty || app.saveState === 'saving' || app.saveState === 'error') return;

		const timer = window.setTimeout(() => {
			void app.saveData(revision);
		}, autoSaveDelayMs);

		return () => window.clearTimeout(timer);
	});

	// Navigation : chaque changement de rubrique ou de fiche ouverte est une étape de l'historique
	// du navigateur (routage léger de SvelteKit). La flèche retour, le bouton retour du navigateur
	// et le geste retour de l'iPhone ramènent à l'étape précédente.
	type Place = NonNullable<App.PageState['intrPlace']>;
	const placeKey = (place: Place | undefined) => (place ? JSON.stringify(place) : '');
	let started = false;
	// Le routeur de SvelteKit n'accepte ces étapes qu'une fois la page chargée.
	let routerReady = $state(false);
	afterNavigate(() => (routerReady = true));
	let depth = $derived(page.state.intrDepth ?? 0);

	function currentPlace(): Place {
		return {
			tab: app.activeTab,
			contract: app.selectedContractId,
			company: app.selectedCompanyId,
			project: app.selectedProjectId,
			companyEdit: app.companyEditId,
			month: app.selectedMonth
		};
	}

	// L'écran a changé : nouvelle étape, sauf si c'est un retour qui l'a ramené.
	$effect(() => {
		const place = currentPlace();
		const key = placeKey(place);
		if (!routerReady) return;
		untrack(() => {
			if (!started) {
				started = true;
				replaceState('', { intrPlace: place, intrDepth: 0 });
				return;
			}
			if (key === placeKey(page.state.intrPlace)) return;
			pushState('', { intrPlace: place, intrDepth: (page.state.intrDepth ?? 0) + 1 });
		});
	});

	// Retour (flèche, navigateur ou geste) : on rouvre l'écran enregistré dans l'étape.
	$effect(() => {
		const place = page.state.intrPlace;
		if (!place || !routerReady) return;
		untrack(() => {
			if (placeKey(place) === placeKey(currentPlace())) return;
			app.activeTab = place.tab as Tab;
			app.selectedContractId = place.contract;
			app.selectedCompanyId = place.company;
			app.selectedProjectId = place.project;
			app.companyEditId = place.companyEdit;
			if (place.month) app.selectedMonth = place.month;
		});
	});

	function goBack() {
		if (depth > 0) history.back();
	}

	function titleFor(tab: Tab) {
		return tabs.find((item) => item.id === tab)?.label ?? '';
	}
</script>

<main class="app-shell" oninput={app.touch} onchange={app.touch}>
	<aside class="sidebar">
		<div class="brand">
			<div class="brand-mark">IM</div>
			<div>
				<h1>INTR</h1>
				<p>
					{app.appData.contracts.length} contrats · {app.appData.companies.length} structures
				</p>
			</div>
		</div>

		<nav aria-label="Navigation principale">
			{#each tabs as tab}
				<button
					class:active={app.activeTab === tab.id}
					type="button"
					title={tab.label}
					onclick={() => (app.activeTab = tab.id)}
				>
					<span>{tab.label}</span>
				</button>
			{/each}
		</nav>

		<div class="save-box">
			<span class:error={app.saveState === 'error'} class:ok={app.saveState === 'saved'}>
				{#if app.saveState === 'saved'}
					JSON à jour
				{:else if app.saveState === 'error'}
					Erreur serveur
				{:else if app.saveState === 'reloaded'}
					Données rechargées, modification à refaire
				{:else if app.dirty}
					Modifications locales
				{:else}
					Prêt
				{/if}
			</span>

			<button
				class="primary"
				type="button"
				onclick={() => app.saveData()}
				disabled={app.saveState === 'saving'}
			>
				{app.saveState === 'saving' ? 'Sauvegarde...' : 'Sauver maintenant'}
			</button>

			<form method="POST" action={`${base}/logout`}>
				<button class="ghost-button logout-button" type="submit">Déconnexion</button>
			</form>
		</div>

		<ServerStatus />

		<div
			class="deployment-info"
			title={`Version ${__APP_VERSION__} · déploiement du ${deployedAtLabel}`}
		>
			<span>v{__APP_VERSION__}</span>
			<span>Déployé le {deployedAtLabel}</span>
		</div>
	</aside>

	<section class="workspace">
		<header class="topbar">
			<div class="topbar-title">
				{#if depth > 0}
					<button class="back-button" type="button" onclick={goBack} aria-label="Retour à la page précédente" title="Retour">
						<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
							<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
						</svg>
						<span>Retour</span>
					</button>
				{/if}
				<h2>{titleFor(app.activeTab)}</h2>
			</div>
		</header>

		{@render children()}
	</section>
</main>
