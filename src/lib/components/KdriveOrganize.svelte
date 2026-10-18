<script lang="ts">
	import { base } from '$app/paths';

	import type { IntrState } from '$lib/app/state.svelte';
	import type { OrganizeEmployer, OrganizeMove, OrganizeSkip } from '$lib/organize';
	import type { AppData } from '$lib/types';

	let { state: app }: { state: IntrState } = $props();

	type Plan = {
		folder: { id: number; name: string };
		moves: OrganizeMove[];
		unchanged: number;
		skipped: OrganizeSkip[];
		currentYear: number;
		employers: OrganizeEmployer[];
	};

	const SOURCE_LABEL: Record<string, string> = {
		bulletin: 'bulletin',
		aem: 'AEM',
		conges: 'certificat congés',
		contrat: 'contrat',
		'siret seul': 'SIRET'
	};

	let editedNames = $state<Record<string, string>>({});

	async function saveEmployerNames() {
		const next = { ...app.appData.settings.employerNames };
		for (const employer of plan?.employers ?? []) {
			const value = (editedNames[employer.siren] ?? employer.name).trim();
			if (!value || value === employer.readName) delete next[employer.siren];
			else next[employer.siren] = value;
		}
		app.appData.settings.employerNames = next;
		app.touch();
		await app.saveData();
		editedNames = {};
		await preparePlan();
	}

	let plan = $state<Plan | null>(null);
	let busy = $state<'' | 'plan' | 'apply' | 'undo' | 'empty' | 'reread'>('');
	let message = $state('');
	let stopRequested = $state(false);
	let progress = $state({ done: 0, total: 0, errors: 0 });
	let failures = $state<{ path: string; message: string }[]>([]);

	let lastBatch = $derived.by(() => {
		const moves = app.appData.kdriveMoves.filter((move) => !move.undone);
		const batchId = moves.at(-1)?.batchId;
		return batchId ? moves.filter((move) => move.batchId === batchId) : [];
	});
	let byDestination = $derived.by(() => {
		const groups = new Map<string, OrganizeMove[]>();
		for (const move of plan?.moves ?? []) {
			const key = move.toDirs.slice(0, move.toDirs[0] === 'Archive' ? 2 : 1).join('/');
			groups.set(key, [...(groups.get(key) ?? []), move]);
		}
		return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0], 'fr', { numeric: true }));
	});

	function folder() {
		return app.appData.settings.kdriveSourceFolder;
	}

	async function preparePlan() {
		busy = 'plan';
		message = 'Lecture du dossier et préparation du rangement...';
		failures = [];
		try {
			const response = await fetch(
				`${base}/api/kdrive/organize?folder=${encodeURIComponent(folder())}`
			);
			const payload = await response.json().catch(() => ({ message: 'Réponse illisible.' }));
			if (!response.ok) {
				message = payload.message ?? `Erreur ${response.status}`;
				plan = null;
				return;
			}
			plan = payload;
			message = payload.moves.length
				? ''
				: `Rien à ranger : ${payload.unchanged} fichiers déjà à leur place.`;
		} catch {
			message = 'Erreur réseau.';
		} finally {
			busy = '';
		}
	}

	async function applyPlan() {
		if (!plan) return;
		busy = 'apply';
		stopRequested = false;
		failures = [];
		const batchId = new Date().toISOString();
		const moves = [...plan.moves];
		progress = { done: 0, total: moves.length, errors: 0 };

		for (const move of moves) {
			if (stopRequested) break;
			try {
				const response = await fetch(`${base}/api/kdrive/organize/apply`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ folderId: plan.folder.id, batchId, move })
				});
				const payload = (await response.json().catch(() => ({}))) as {
					ok?: boolean;
					data?: AppData;
					message?: string;
				};
				if (payload.data) app.appData = payload.data;
				if (!payload.ok) {
					progress.errors += 1;
					failures.push({ path: move.fromPath, message: payload.message ?? `Erreur ${response.status}` });
				}
			} catch {
				progress.errors += 1;
				failures.push({ path: move.fromPath, message: 'Erreur réseau.' });
			}
			progress.done += 1;
		}

		busy = '';
		plan = null;
		message = `${stopRequested ? 'Rangement interrompu' : 'Rangement terminé'} : ${progress.done - progress.errors} fichiers rangés, ${progress.errors} erreurs.`;
	}

	async function undoLast() {
		const moves = [...lastBatch].reverse();
		busy = 'undo';
		failures = [];
		progress = { done: 0, total: moves.length, errors: 0 };
		for (const move of moves) {
			try {
				const response = await fetch(`${base}/api/kdrive/organize/undo`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ batchId: move.batchId, fileId: move.fileId })
				});
				const payload = (await response.json().catch(() => ({}))) as {
					ok?: boolean;
					data?: AppData;
					message?: string;
				};
				if (payload.data) app.appData = payload.data;
				if (!payload.ok) {
					progress.errors += 1;
					failures.push({ path: move.toPath, message: payload.message ?? `Erreur ${response.status}` });
				}
			} catch {
				progress.errors += 1;
				failures.push({ path: move.toPath, message: 'Erreur réseau.' });
			}
			progress.done += 1;
		}
		busy = '';
		plan = null;
		message = `Rangement annulé : ${progress.done - progress.errors} fichiers remis en place, ${progress.errors} erreurs.`;
	}

	// Documents importés avec l'ancien extrait court (1 200 caractères) : à relire pour y trouver
	// employeur et date de contrat.
	let shortTexts = $derived(
		app.appData.documents.filter((document) => (document.extractedTextPreview ?? '').length <= 1203)
	);
	let dateWarnings = $derived(plan?.moves.filter((move) => move.dateWarning).length ?? 0);

	async function rereadDocuments() {
		const ids = shortTexts.map((document) => document.id);
		busy = 'reread';
		failures = [];
		progress = { done: 0, total: ids.length, errors: 0 };
		for (let index = 0; index < ids.length; index += 5) {
			const batch = ids.slice(index, index + 5);
			try {
				const response = await fetch(`${base}/api/documents/reread`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ids: batch })
				});
				const payload = (await response.json().catch(() => ({}))) as {
					failures?: { id: string; message: string }[];
					message?: string;
				};
				if (!response.ok) {
					progress.errors += batch.length;
					failures.push({ path: `lot ${index / 5 + 1}`, message: payload.message ?? `Erreur ${response.status}` });
				}
				for (const failure of payload.failures ?? []) {
					progress.errors += 1;
					failures.push({ path: failure.id, message: failure.message });
				}
			} catch {
				progress.errors += batch.length;
				failures.push({ path: `lot ${index / 5 + 1}`, message: 'Erreur réseau.' });
			}
			progress.done += batch.length;
		}
		const fresh = await fetch(`${base}/api/data`).then((response) => response.json()).catch(() => null);
		if (fresh) app.appData = fresh;
		busy = '';
		message = `Textes relus : ${progress.done - progress.errors} documents, ${progress.errors} erreurs.`;
		if (plan) await preparePlan();
	}

	async function trashEmpty() {
		busy = 'empty';
		try {
			const response = await fetch(`${base}/api/kdrive/organize/empty`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ folder: folder() })
			});
			const payload = (await response.json().catch(() => ({}))) as {
				ok?: boolean;
				trashed?: string[];
				message?: string;
			};
			message = payload.ok
				? payload.trashed?.length
					? `${payload.trashed.length} dossiers vides mis à la corbeille : ${payload.trashed.join(', ')}.`
					: 'Aucun dossier vide.'
				: (payload.message ?? 'Erreur.');
		} catch {
			message = 'Erreur réseau.';
		} finally {
			busy = '';
		}
	}
</script>

<div class="sync-card">
	<div class="panel-heading">
		<h3>Ranger le dossier kDrive</h3>
	</div>
	<p class="muted">
		Range chaque document importé dans <strong>Année/Mois/Employeur</strong> (années
		d’intermittence, selon ta date anniversaire), les années passées sous <strong>Archive</strong>,
		et le renomme « [BP] AAAA-MM-JJ Employeur » ([BP] bulletin de paie, [AEM], [CS] Congés
		Spectacles, [CT] contrat, [ARE] notification, [GUSO], [DOC] autre). Rien ne bouge avant que tu
		valides l’aperçu, et chaque rangement peut être annulé.
	</p>

	{#if !folder()}
		<p class="muted">Lis d’abord ton dossier dans « Import depuis kDrive » ci-dessus.</p>
	{:else}
		{#if shortTexts.length}
			<p class="muted">
				{shortTexts.length} documents ont été importés avec un texte court : relis-les d’abord pour
				que l’employeur et la date du contrat y soient mieux trouvés (quelques minutes).
			</p>
			<div class="button-row">
				<button type="button" onclick={rereadDocuments} disabled={busy !== ''}>
					{busy === 'reread' ? 'Relecture...' : `Relire ${shortTexts.length} documents`}
				</button>
			</div>
		{/if}
		<div class="button-row">
			<button type="button" onclick={preparePlan} disabled={busy !== ''}>
				{busy === 'plan' ? 'Préparation...' : 'Préparer le rangement'}
			</button>
			{#if plan?.moves.length}
				<button type="button" class="primary" onclick={applyPlan} disabled={busy !== ''}>
					Ranger {plan.moves.length} fichier{plan.moves.length > 1 ? 's' : ''}
				</button>
			{/if}
			{#if busy === 'apply'}
				<button type="button" onclick={() => (stopRequested = true)}>Arrêter</button>
			{/if}
		</div>
	{/if}

	{#if message}<p class="muted">{message}</p>{/if}

	{#if busy === 'apply' || busy === 'undo' || busy === 'reread'}
		<div class="progress-line">
			<progress max={progress.total} value={progress.done}></progress>
			<small>{progress.done} / {progress.total}</small>
		</div>
	{/if}

	{#if plan?.employers.length}
		<details class="plan-group" open>
			<summary>{plan.employers.length} employeurs lus dans les documents</summary>
			<p class="muted">
				Nom lu dans les documents (regroupés par SIREN). Corrige un nom ici : il vaudra pour tous
				ses fichiers.
			</p>
			<ul class="employers">
				{#each plan.employers as employer (employer.siren)}
					<li>
						<input
							value={editedNames[employer.siren] ?? employer.name}
							oninput={(event) => (editedNames[employer.siren] = event.currentTarget.value)}
							aria-label={`Nom de l’employeur SIREN ${employer.siren}`}
						/>
						<small>
							SIREN {employer.siren} · {employer.files} fichier{employer.files > 1 ? 's' : ''}
							{#if employer.corrected}· lu « {employer.readName} »{/if}
						</small>
					</li>
				{/each}
			</ul>
			{#if Object.keys(editedNames).length}
				<button type="button" onclick={saveEmployerNames} disabled={busy !== ''}>
					Enregistrer les noms et refaire l’aperçu
				</button>
			{/if}
		</details>
	{/if}

	{#if plan?.moves.length}
		<p class="muted">
			Aperçu : {plan.moves.length} à ranger, {plan.unchanged} déjà en place,
			{plan.skipped.length} laissés où ils sont. L’année en cours est {plan.currentYear}.
			{#if dateWarnings}
				<strong class="warn">{dateWarnings} date{dateWarnings > 1 ? 's' : ''} à vérifier</strong> (marquées
				ci-dessous).
			{/if}

		</p>
		{#each byDestination as [destination, moves] (destination)}
			<details class="plan-group">
				<summary>{destination} · {moves.length} fichier{moves.length > 1 ? 's' : ''}</summary>
				<ul>
					{#each moves as move (move.fileId)}
						<li>
							<span class="from">{move.fromPath}</span>
							<span class="to">→ {move.toPath}</span>
							<small>employeur lu : {SOURCE_LABEL[move.employerSource] ?? move.employerSource}</small>
							{#if move.dateWarning}<small class="warn">Date à vérifier : {move.dateWarning}</small>{/if}
						</li>
					{/each}
				</ul>
			</details>
		{/each}
	{/if}

	{#if plan?.skipped.length}
		<details class="plan-group">
			<summary>{plan.skipped.length} laissés où ils sont</summary>
			<ul>
				{#each plan.skipped as skip (skip.fileId)}
					<li><span class="from">{skip.path}</span><small>{skip.reason}</small></li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if failures.length}
		<details class="plan-group" open>
			<summary>{failures.length} erreur{failures.length > 1 ? 's' : ''}</summary>
			<ul>
				{#each failures as failure, index (index)}
					<li><span class="from">{failure.path}</span><small class="warn">{failure.message}</small></li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if lastBatch.length && busy === ''}
		<div class="button-row">
			<button type="button" onclick={undoLast}>
				Annuler le dernier rangement ({lastBatch.length} fichier{lastBatch.length > 1 ? 's' : ''})
			</button>
			<button type="button" onclick={trashEmpty}>Dossiers vides à la corbeille</button>
		</div>
	{/if}
</div>

<style>
	.muted {
		margin: 0;
		color: rgba(237, 241, 238, 0.68);
	}

	.progress-line {
		display: grid;
		gap: 4px;
	}

	.progress-line progress {
		width: 100%;
	}

	.plan-group summary {
		cursor: pointer;
	}

	.plan-group ul {
		display: grid;
		gap: 6px;
		margin: 6px 0 0;
		padding: 0;
		list-style: none;
		max-height: 320px;
		overflow-y: auto;
	}

	.plan-group li {
		display: grid;
		gap: 1px;
		font-size: 12px;
		overflow-wrap: anywhere;
	}

	.from {
		color: rgba(237, 241, 238, 0.6);
	}

	.to {
		color: #67d8c2;
	}

	.warn {
		color: #dfad4a;
	}

	.employers {
		display: grid;
		gap: 8px;
		margin: 8px 0;
		padding: 0;
		list-style: none;
	}

	.employers li {
		display: grid;
		gap: 2px;
	}

	.employers input {
		width: 100%;
		min-width: 0;
	}
</style>
