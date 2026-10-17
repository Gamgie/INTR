import { base } from '$app/paths';
import { passwordIsConfigured, passwordIsValid, rememberClient } from '$lib/server/access';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

type Attempt = {
	count: number;
	expiresAt: number;
};

const attempts = new Map<string, Attempt>();

function clientKey(getClientAddress: () => string, userAgent: string | null) {
	let address = 'unknown';

	try {
		address = getClientAddress();
	} catch {}

	return `${address}:${userAgent?.slice(0, 160) || 'unknown'}`;
}

function currentAttempt(key: string, now: number) {
	if (attempts.size >= 1_000) {
		for (const [storedKey, storedAttempt] of attempts) {
			if (storedAttempt.expiresAt <= now) attempts.delete(storedKey);
		}

		if (attempts.size >= 1_000) {
			attempts.delete(attempts.keys().next().value as string);
		}
	}

	const attempt = attempts.get(key);

	if (!attempt || attempt.expiresAt <= now) {
		const fresh = { count: 0, expiresAt: now + ATTEMPT_WINDOW_MS };
		attempts.set(key, fresh);
		return fresh;
	}

	return attempt;
}

function safeDestination(candidate: string | null) {
	const fallback = `${base}/`;
	if (!candidate) return fallback;

	try {
		const destination = new URL(candidate, 'http://intermittens.local');
		const requiredPrefix = base ? `${base}/` : '/';

		if (
			destination.origin !== 'http://intermittens.local' ||
			!destination.pathname.startsWith(requiredPrefix)
		) {
			return fallback;
		}

		return `${destination.pathname}${destination.search}${destination.hash}`;
	} catch {
		return fallback;
	}
}

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.authenticated) {
		throw redirect(303, safeDestination(url.searchParams.get('next')));
	}
};

export const actions: Actions = {
	default: async ({ cookies, getClientAddress, request, url }) => {
		const key = clientKey(getClientAddress, request.headers.get('user-agent'));
		const now = Date.now();
		const attempt = currentAttempt(key, now);

		if (attempt.count >= MAX_ATTEMPTS) {
			return fail(429, { error: 'Trop de tentatives. Réessayez dans quelques minutes.' });
		}

		const formData = await request.formData();
		const password = formData.get('password');

		if (!passwordIsConfigured()) {
			return fail(503, { error: 'Accès fermé : la variable ACCESS_PASSWORD n’est pas configurée.' });
		}

		if (typeof password !== 'string' || !passwordIsValid(password)) {
			attempt.count += 1;
			return fail(400, { error: 'Mot de passe incorrect.' });
		}

		attempts.delete(key);
		rememberClient(cookies, url.protocol === 'https:');
		throw redirect(303, safeDestination(url.searchParams.get('next')));
	}
};
