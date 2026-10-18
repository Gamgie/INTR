#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';

const root = process.cwd();
const action = process.argv[2] || 'status';

async function fileExists(filePath) {
	try {
		await readFile(filePath, 'utf-8');
		return true;
	} catch {
		return false;
	}
}

function parseEnv(text) {
	const env = {};

	for (const line of text.split(/\r?\n/)) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (!match) continue;

		const [, key, rawValue] = match;
		let value = rawValue.trim();

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		env[key] = value.replace(/\\n/g, '\n');
	}

	return env;
}

async function loadEnv() {
	const env = {};

	for (const filename of ['.env', '.env.deploy', '.env.local']) {
		const filePath = path.join(root, filename);
		if (await fileExists(filePath)) Object.assign(env, parseEnv(await readFile(filePath, 'utf-8')));
	}

	return { ...env, ...process.env };
}

function resolveProjectPath(filePath) {
	if (!filePath) return filePath;
	return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function trimTrailingSlash(value) {
	return value.replace(/\/+$/, '');
}

function publicOriginFromUrl(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return '';

	const url = new URL(raw);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error('DEPLOY_PUBLIC_ORIGIN/DEPLOY_HEALTH_URL must use http:// or https://.');
	}

	return url.origin;
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function normalizeBasePath(value) {
	const basePath = String(value || '').trim();
	if (!basePath || basePath === '/') return '';
	if (!basePath.startsWith('/')) throw new Error('DEPLOY_BASE_PATH must start with /.');
	if (/^https?:\/\//i.test(basePath)) throw new Error('DEPLOY_BASE_PATH must not be a full URL.');
	return trimTrailingSlash(basePath);
}

function inferBasePathFromRemotePath(remotePath) {
	const lastSegment = trimTrailingSlash(String(remotePath ?? ''))
		.split('/')
		.filter(Boolean)
		.at(-1);
	return lastSegment ? `/${lastSegment}` : '';
}

function npmPathFromNodePath(nodePath) {
	return nodePath.endsWith('/node') ? `${nodePath.slice(0, -5)}/npm` : 'npm';
}

function proxyHtaccess(basePath, port) {
	const base = basePath || '';
	const rewriteBase = base ? `${base}/` : '/';
	const targetBase = `http://127.0.0.1:${port}${base}`;

	return `Options -Indexes
RewriteEngine On
RewriteBase ${rewriteBase}
RewriteRule ^index\\.html$ ${targetBase}/ [P,L]
RewriteRule ^$ ${targetBase}/ [P,L]
RewriteRule ^(.*)$ ${targetBase}/$1 [P,L,QSA]
`;
}

async function loadConfig(env) {
	const sftpConfigPath = resolveProjectPath(
		env.DEPLOY_SFTP_CONFIG || path.join('.vscode', 'sftp.json')
	);
	const sftpConfig = JSON.parse(await readFile(sftpConfigPath, 'utf-8'));
	const remoteRoot = trimTrailingSlash(String(sftpConfig.remotePath));

	return {
		sftpConfig,
		remoteRoot,
		basePath: normalizeBasePath(env.DEPLOY_BASE_PATH || inferBasePathFromRemotePath(remoteRoot)),
		nodePath: String(env.DEPLOY_REMOTE_NODE || '/opt/plesk/node/22/bin/node'),
		npmPath: String(
			env.DEPLOY_REMOTE_NPM ||
				npmPathFromNodePath(String(env.DEPLOY_REMOTE_NODE || '/opt/plesk/node/22/bin/node'))
		),
		port: String(env.DEPLOY_REMOTE_PORT || '3017'),
		publicOrigin: publicOriginFromUrl(env.DEPLOY_PUBLIC_ORIGIN || env.DEPLOY_HEALTH_URL),
		bodySizeLimit: String(env.DEPLOY_BODY_SIZE_LIMIT || env.BODY_SIZE_LIMIT || '10485760').trim()
	};
}

function sshExec(config, command) {
	return new Promise((resolve, reject) => {
		const conn = new Client();

		conn
			.on('ready', () => {
				conn.exec(command, (error, stream) => {
					if (error) {
						conn.end();
						reject(error);
						return;
					}

					let stdout = '';
					let stderr = '';
					stream.on('data', (data) => (stdout += data.toString()));
					stream.stderr.on('data', (data) => (stderr += data.toString()));
					stream.on('close', (code) => {
						conn.end();
						resolve({ code, stdout, stderr });
					});
				});
			})
			.on('error', reject)
			.connect({
				host: config.sftpConfig.host,
				port: config.sftpConfig.port ?? 22,
				username: config.sftpConfig.username,
				password: config.sftpConfig.password,
				readyTimeout: 12000
			});
	});
}

async function writeProxy(config) {
	const client = new SftpClient('intr-runtime');
	await client.connect({
		host: config.sftpConfig.host,
		port: config.sftpConfig.port ?? 22,
		username: config.sftpConfig.username,
		password: config.sftpConfig.password
	});

	try {
		await client.put(
			Buffer.from(proxyHtaccess(config.basePath, config.port), 'utf-8'),
			`${config.remoteRoot}/.htaccess`
		);
	} finally {
		await client.end();
	}
}

function startCommand(config) {
	const healthPath = `${config.basePath || ''}/`;

	return `
set -eu
APP_DIR=${shellQuote(config.remoteRoot)}
NODE=${shellQuote(config.nodePath)}
PORT=${shellQuote(config.port)}
HEALTH_PATH=${shellQuote(healthPath)}
PUBLIC_ORIGIN=${shellQuote(config.publicOrigin)}
BODY_SIZE_LIMIT=${shellQuote(config.bodySizeLimit)}
cd "$APP_DIR"
mkdir -p tmp
if [ -f tmp/app.pid ]; then
	old_pid="$(cat tmp/app.pid || true)"
	if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
		kill "$old_pid" || true
		sleep 1
	fi
fi
if [ -n "$PUBLIC_ORIGIN" ]; then
	export ORIGIN="$PUBLIC_ORIGIN"
fi
if [ -n "$BODY_SIZE_LIMIT" ]; then
	export BODY_SIZE_LIMIT="$BODY_SIZE_LIMIT"
fi
HOST=127.0.0.1 PORT="$PORT" NODE_ENV=production nohup "$NODE" build/index.js > tmp/app.out.log 2> tmp/app.err.log < /dev/null &
echo $! > tmp/app.pid
sleep 2
printf 'pid='
cat tmp/app.pid
printf '\\nlocal_status='
curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$HEALTH_PATH" || true
printf '\\n'
`;
}

function installCommand(config) {
	return `
set -eu
APP_DIR=${shellQuote(config.remoteRoot)}
NPM=${shellQuote(config.npmPath)}
cd "$APP_DIR"
mkdir -p tmp
current_hash="$(sha256sum package-lock.json | awk '{print $1}')"
installed_hash="$(cat tmp/package-lock.sha256 2>/dev/null || true)"
if [ -d node_modules ] && [ "$current_hash" = "$installed_hash" ]; then
	echo dependencies=unchanged
	exit 0
fi
"$NPM" ci --omit=dev --ignore-scripts --no-audit --no-fund
printf '%s\\n' "$current_hash" > tmp/package-lock.sha256
echo dependencies=installed
`;
}

function stopCommand(config) {
	return `
set -eu
APP_DIR=${shellQuote(config.remoteRoot)}
cd "$APP_DIR"
if [ -f tmp/app.pid ]; then
	old_pid="$(cat tmp/app.pid || true)"
	if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
		kill "$old_pid" || true
		echo stopped
		exit 0
	fi
fi
echo not-running
`;
}

function statusCommand(config) {
	const healthPath = `${config.basePath || ''}/`;

	return `
set +e
APP_DIR=${shellQuote(config.remoteRoot)}
PORT=${shellQuote(config.port)}
HEALTH_PATH=${shellQuote(healthPath)}
cd "$APP_DIR" 2>/dev/null || exit 2
pid=''
if [ -f tmp/app.pid ]; then pid="$(cat tmp/app.pid || true)"; fi
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
	printf 'process=running\\n'
	printf 'pid=%s\\n' "$pid"
else
	printf 'process=stopped\\n'
fi
printf 'local_status='
curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$HEALTH_PATH" || true
printf '\\n'
`;
}

async function checkPublic(url) {
	if (!url) return;

	try {
		const response = await fetch(url, { redirect: 'follow' });
		console.log(`public_status=${response.status}`);
	} catch {
		console.log('public_status=unreachable');
	}
}

async function main() {
	if (!['install', 'start', 'stop', 'restart', 'status'].includes(action)) {
		throw new Error('Usage: node scripts/remote-runtime.mjs <install|start|stop|restart|status>');
	}

	const env = await loadEnv();
	const config = await loadConfig(env);

	if (action === 'install') {
		const result = await sshExec(config, installCommand(config));
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
	}

	if (action === 'stop' || action === 'restart') {
		const result = await sshExec(config, stopCommand(config));
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
	}

	if (action === 'start' || action === 'restart') {
		await writeProxy(config);
		const result = await sshExec(config, startCommand(config));
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
	}

	if (action === 'status') {
		const result = await sshExec(config, statusCommand(config));
		process.stdout.write(result.stdout);
		process.stderr.write(result.stderr);
	}

	await checkPublic(String(env.DEPLOY_HEALTH_URL || '').trim());
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
