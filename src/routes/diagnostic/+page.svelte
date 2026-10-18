<script lang="ts">
	import { base } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let allOk = $derived(data.steps.every((step) => step.ok));
</script>

<svelte:head>
	<title>Diagnostic · INTR</title>
</svelte:head>

<main class="access-page">
	<section class="access-card diagnostic">
		<p class="access-eyebrow">Diagnostic kDrive</p>
		<h1>{allOk ? 'Tout fonctionne' : 'Un réglage bloque'}</h1>
		<ol>
			{#each data.steps as step, index (index)}
				<li class:ok={step.ok} class:ko={step.ok === false}>
					<strong>{step.ok ? '✓' : '✗'} {step.label}</strong>
					<span>{step.detail}</span>
				</li>
			{/each}
		</ol>
		<p>
			Après une modification des variables dans Vercel, il faut redéployer
			(Deployments, ⋯, Redeploy) puis recharger cette page.
		</p>
		<div class="button-row">
			<a class="primary-link" href={`${base}/diagnostic`}>Relancer</a>
			{#if allOk}<a href={`${base}/`}>Ouvrir INTR</a>{/if}
		</div>
	</section>
</main>

<style>
	.diagnostic {
		max-width: 640px;
	}

	ol {
		display: grid;
		gap: 10px;
		margin: 16px 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		gap: 4px;
		padding: 10px 12px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 10px;
		overflow-wrap: anywhere;
	}

	li.ok strong {
		color: #67d8c2;
	}

	li.ko {
		border-color: rgba(240, 120, 100, 0.55);
	}

	li.ko strong {
		color: #f39a86;
	}

	.button-row {
		display: flex;
		gap: 16px;
		align-items: center;
	}

	a {
		color: #67d8c2;
	}
</style>
