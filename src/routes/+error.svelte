<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>Erreur · INTR</title>
</svelte:head>

<main class="access-page">
	<section class="access-card">
		<p class="access-eyebrow">Erreur {page.status}</p>
		<h1>INTR n’arrive pas à ouvrir tes données</h1>
		<p>{page.error?.message}</p>
		<p><a href={`${base}/diagnostic`}>Lancer le diagnostic kDrive</a></p>
	</section>
</main>

<style>
	a {
		color: #67d8c2;
	}

	p {
		overflow-wrap: anywhere;
	}
</style>
