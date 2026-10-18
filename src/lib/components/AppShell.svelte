<script lang="ts">
	import { base } from '$app/paths';
	import ServerStatus from '$lib/components/ServerStatus.svelte';
	import type { IntrState, Tab } from '$lib/app/state.svelte';
	import { tabs } from '$lib/app/state.svelte';

	let { state, children }: { state: IntrState; children: import('svelte').Snippet } =
		$props();

	const autoSaveDelayMs = 900;
	const deployedAtLabel = new Intl.DateTimeFormat('fr-FR', {
		dateStyle: 'short',
		timeStyle: 'short',
		timeZone: 'Europe/Paris'
	}).format(new Date(__DEPLOYED_AT__));

	$effect(() => {
		const revision = state.changeRevision;

		if (!state.dirty || state.saveState === 'saving' || state.saveState === 'error') return;

		const timer = window.setTimeout(() => {
			void state.saveData(revision);
		}, autoSaveDelayMs);

		return () => window.clearTimeout(timer);
	});

	function titleFor(tab: Tab) {
		return tabs.find((item) => item.id === tab)?.label ?? '';
	}
</script>

<main class="app-shell" oninput={state.touch} onchange={state.touch}>
	<aside class="sidebar">
		<div class="brand">
			<div class="brand-mark">IM</div>
			<div>
				<h1>INTR</h1>
				<p>
					{state.appData.contracts.length} contrats · {state.appData.companies.length} structures
				</p>
			</div>
		</div>

		<nav aria-label="Navigation principale">
			{#each tabs as tab}
				<button
					class:active={state.activeTab === tab.id}
					type="button"
					title={tab.label}
					onclick={() => (state.activeTab = tab.id)}
				>
					<span>{tab.label}</span>
				</button>
			{/each}
		</nav>

		<div class="save-box">
			<span class:error={state.saveState === 'error'} class:ok={state.saveState === 'saved'}>
				{#if state.saveState === 'saved'}
					JSON à jour
				{:else if state.saveState === 'error'}
					Erreur serveur
				{:else if state.dirty}
					Modifications locales
				{:else}
					Prêt
				{/if}
			</span>

			<button
				class="primary"
				type="button"
				onclick={() => state.saveData()}
				disabled={state.saveState === 'saving'}
			>
				{state.saveState === 'saving' ? 'Sauvegarde...' : 'Sauver maintenant'}
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
			<div>
				<h2>{titleFor(state.activeTab)}</h2>
			</div>
		</header>

		{@render children()}
	</section>
</main>
