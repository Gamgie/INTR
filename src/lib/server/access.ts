import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { base } from '$app/paths';
import type { Cookies } from '@sveltejs/kit';

const ACCESS_COOKIE = 'intermittens_access';
const COOKIE_VERSION = 'v1';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

function configuredPassword() {
	return env.ACCESS_PASSWORD?.trim();
}

function digest(value: string) {
	return createHash('sha256').update(value, 'utf8').digest();
}

function sessionToken() {
	// No built-in fallback password: without ACCESS_PASSWORD, no cookie can ever be valid.
	const passwordCredential = configuredPassword() || `unset:${Math.random()}`;

	return `${COOKIE_VERSION}.${digest(
		`intermittens:${COOKIE_VERSION}:${passwordCredential}`
	).toString('base64url')}`;
}

function safelyEqual(left: string, right: string) {
	const leftDigest = digest(left);
	const rightDigest = digest(right);
	return timingSafeEqual(leftDigest, rightDigest);
}

function cookiePath() {
	return base || '/';
}

export function passwordIsConfigured() {
	return Boolean(configuredPassword());
}

export function passwordIsValid(candidate: string) {
	const password = configuredPassword();
	return password ? safelyEqual(candidate, password) : false;
}

export function hasValidAccessCookie(cookies: Cookies) {
	const candidate = cookies.get(ACCESS_COOKIE);
	return candidate ? safelyEqual(candidate, sessionToken()) : false;
}

export function rememberClient(cookies: Cookies, secure: boolean) {
	cookies.set(ACCESS_COOKIE, sessionToken(), {
		httpOnly: true,
		maxAge: COOKIE_MAX_AGE,
		path: cookiePath(),
		sameSite: 'strict',
		secure
	});
}

export function forgetClient(cookies: Cookies, secure: boolean) {
	cookies.delete(ACCESS_COOKIE, {
		path: cookiePath(),
		secure
	});
}
