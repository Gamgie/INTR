// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	const __APP_VERSION__: string;
	const __DEPLOYED_AT__: string;

	namespace App {
		// interface Error {}
		interface Locals {
			authenticated: boolean;
		}
		// interface PageData {}
		interface PageState {
			/** Rubrique et fiches ouvertes, pour la flèche retour. */
			intrPlace?: {
				tab: string;
				contract: string;
				company: string;
				project: string;
				companyEdit: string;
				month: string;
			};
			intrDepth?: number;
		}
		// interface Platform {}
	}
}

export {};
