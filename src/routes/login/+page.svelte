<script lang="ts">
	let { form }: { form?: { error?: string } } = $props();
</script>

<svelte:head>
	<title>Accès sécurisé · INTR</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="access-page">
	<section class="access-card" aria-labelledby="access-title">
		<div class="access-brand" aria-hidden="true">IM</div>
		<p class="access-eyebrow">Espace privé</p>
		<h1 id="access-title">Bienvenue sur INTR</h1>
		<p class="access-intro">
			Saisissez le mot de passe pour accéder à votre espace. Cet appareil sera ensuite reconnu
			pendant 6 mois.
		</p>

		<form method="POST" class="access-form">
			<label for="password">Mot de passe</label>
			<input
				id="password"
				name="password"
				type="password"
				autocomplete="current-password"
				required
				aria-invalid={form?.error ? 'true' : undefined}
				aria-describedby={form?.error ? 'access-error' : undefined}
			/>

			{#if form?.error}
				<p id="access-error" class="access-error" role="alert">{form.error}</p>
			{/if}

			<button class="primary" type="submit">Accéder à INTR</button>
		</form>

		<p class="access-note">Connexion mémorisée uniquement sur ce navigateur.</p>
	</section>
</main>
