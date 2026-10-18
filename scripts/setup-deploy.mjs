#!/usr/bin/env node

import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const root = process.cwd();
const envPath = path.join(root, '.env.local');
const args = new Set(process.argv.slice(2));

function npmCommand() {
	return 'npm';
}

function spawnCommand(command, commandArgs) {
	if (process.platform === 'win32' && /^npm(?:\.cmd)?$/i.test(path.basename(command))) {
		return {
			command: process.env.ComSpec || 'cmd.exe',
			commandArgs: ['/d', '/s', '/c', ['npm', ...commandArgs].join(' ')]
		};
	}

	return { command, commandArgs };
}

async function fileExists(filePath) {
	try {
		await stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function readJsonIfExists(filePath) {
	if (!(await fileExists(filePath))) return null;
	return JSON.parse(await readFile(filePath, 'utf-8'));
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

async function loadLocalEnv() {
	if (!(await fileExists(envPath))) return {};
	return parseEnv(await readFile(envPath, 'utf-8'));
}

function formatEnvValue(value) {
	if (!value) return '';
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
	return JSON.stringify(value);
}

async function upsertEnv(values) {
	const existing = (await fileExists(envPath)) ? await readFile(envPath, 'utf-8') : '';
	const lines = existing ? existing.split(/\r?\n/) : [];
	const written = new Set();
	const nextLines = [];

	for (const line of lines) {
		const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);

		if (match && Object.hasOwn(values, match[1])) {
			nextLines.push(`${match[1]}=${formatEnvValue(values[match[1]])}`);
			written.add(match[1]);
			continue;
		}

		nextLines.push(line);
	}

	if (!existing) {
		nextLines.push('# Local deployment settings. This file is ignored by git.');
		nextLines.push('');
	}

	const missing = Object.entries(values).filter(([key]) => !written.has(key));
	if (missing.length > 0) {
		if (nextLines.length > 0 && nextLines.at(-1) !== '') nextLines.push('');
		for (const [key, value] of missing) {
			nextLines.push(`${key}=${formatEnvValue(value)}`);
		}
	}

	await writeFile(envPath, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, 'utf-8');
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sshArgs(env, forScp = false) {
	const options = [];

	if (env.DEPLOY_PORT && env.DEPLOY_PORT !== '22') {
		options.push(forScp ? '-P' : '-p', env.DEPLOY_PORT);
	}

	if (env.DEPLOY_SSH_KEY) {
		options.push('-i', env.DEPLOY_SSH_KEY);
	}

	return options;
}

function sshTarget(env) {
	if (env.DEPLOY_SSH_TARGET) return env.DEPLOY_SSH_TARGET;
	if (env.DEPLOY_HOST && env.DEPLOY_USER) return `${env.DEPLOY_USER}@${env.DEPLOY_HOST}`;
	return '';
}

function validateBasePath(value) {
	if (!value || value === '/') return;
	if (/^https?:\/\//i.test(value)) {
		throw new Error('DEPLOY_BASE_PATH must be a path only, not a full public URL.');
	}

	if (!value.startsWith('/')) {
		throw new Error('DEPLOY_BASE_PATH must start with /, or be empty for a root deployment.');
	}
}

function trimTrailingSlash(value) {
	return value.replace(/\/+$/, '');
}

function inferBasePathFromRemotePath(remotePath) {
	const lastSegment = trimTrailingSlash(String(remotePath ?? ''))
		.split('/')
		.filter(Boolean)
		.at(-1);
	return lastSegment ? `/${lastSegment}` : '';
}

function remoteJoin(base, ...parts) {
	const startsWithSlash = String(base).startsWith('/');
	const joined = [base, ...parts]
		.map((part) => String(part).replace(/^\/+|\/+$/g, ''))
		.filter(Boolean)
		.join('/');

	return startsWithSlash ? `/${joined}` : joined;
}

function resolveProjectPath(filePath) {
	if (!filePath) return filePath;
	return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function relativeProjectPath(filePath) {
	return path.relative(root, filePath).replace(/\\/g, '/') || filePath;
}

function requireConfigValue(config, key, source) {
	const value = config?.[key];
	if (value === undefined || value === null || String(value).trim() === '') {
		throw new Error(`${key} is missing from ${source}.`);
	}

	return value;
}

async function sftpConnectionConfig(config, source) {
	if (config.protocol && config.protocol !== 'sftp') {
		throw new Error(`${source} must use protocol "sftp".`);
	}

	const connection = {
		host: String(requireConfigValue(config, 'host', source)),
		port: Number(config.port ?? 22),
		username: String(requireConfigValue(config, 'username', source))
	};

	if (config.password) connection.password = String(config.password);
	if (config.passphrase) connection.passphrase = String(config.passphrase);
	if (config.privateKeyPath) {
		connection.privateKey = await readFile(resolveProjectPath(String(config.privateKeyPath)));
	}

	return connection;
}

async function run(command, commandArgs, options = {}) {
	const label = options.label ?? [command, ...commandArgs].join(' ');
	console.log(`> ${label}`);
	const spawnTarget = spawnCommand(command, commandArgs);

	return await new Promise((resolve, reject) => {
		const child = spawn(spawnTarget.command, spawnTarget.commandArgs, {
			cwd: root,
			env: { ...process.env, ...(options.env ?? {}) },
			stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit'
		});

		if (options.input) child.stdin.end(options.input);

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0 || options.allowFailure) {
				resolve(code ?? 0);
				return;
			}

			reject(new Error(`${label} failed with exit code ${code}`));
		});
	});
}

async function setupSshRemote(env) {
	const target = sshTarget(env);

	if (!target || !env.DEPLOY_PATH) {
		console.log('Remote directory setup skipped because SSH target or DEPLOY_PATH is empty.');
		return;
	}

	const remoteRoot = trimTrailingSlash(env.DEPLOY_PATH);
	const remoteScript = `
set -eu
mkdir -p ${shellQuote(`${remoteRoot}/releases`)}
mkdir -p ${shellQuote(`${remoteRoot}/shared/data/documents`)}
`;

	await run('ssh', [...sshArgs(env), target, 'sh', '-s'], {
		input: remoteScript,
		label: 'ssh remote directory setup'
	});
}

async function setupSftpRemote(config, configPath) {
	const { default: SftpClient } = await import('ssh2-sftp-client');
	const source = relativeProjectPath(configPath);
	const remoteRoot = trimTrailingSlash(String(requireConfigValue(config, 'remotePath', source)));
	const client = new SftpClient('intr-setup');

	console.log(`> sftp remote directory setup (${source})`);
	await client.connect(await sftpConnectionConfig(config, source));

	try {
		await client.mkdir(remoteRoot, true);
		await client.mkdir(remoteJoin(remoteRoot, 'data', 'documents'), true);
	} finally {
		await client.end();
	}
}

async function main() {
	const current = await loadLocalEnv();
	const sftpConfigPath = resolveProjectPath(
		current.DEPLOY_SFTP_CONFIG || path.join('.vscode', 'sftp.json')
	);
	const sftpConfig = await readJsonIfExists(sftpConfigPath);
	const rl = createInterface({
		input: process.stdin,
		output: process.stdout
	});

	try {
		const ask = async (key, question, fallback = '') => {
			const existing = current[key] ?? fallback;
			const suffix = existing ? ` [${existing}]` : '';
			const answer = await rl.question(`${question}${suffix}: `);
			return answer.trim() || existing;
		};

		let values;
		let remoteSetup = async () => {};

		if (sftpConfig) {
			const source = relativeProjectPath(sftpConfigPath);
			const answer = await rl.question(`Use local SFTP config from ${source}? [Y/n]: `);
			const useSftp = !answer.trim().toLowerCase().startsWith('n');

			if (useSftp) {
				values = {
					DEPLOY_TRANSPORT: 'sftp',
					DEPLOY_SFTP_CONFIG: source,
					DEPLOY_BASE_PATH: await ask(
						'DEPLOY_BASE_PATH',
						'Public base path only, not a full URL',
						inferBasePathFromRemotePath(sftpConfig.remotePath)
					),
					DEPLOY_INSTALL_COMMAND: await ask(
						'DEPLOY_INSTALL_COMMAND',
						'Remote install command (SSH mode only)'
					),
					DEPLOY_UPLOAD_NODE_MODULES: await ask(
						'DEPLOY_UPLOAD_NODE_MODULES',
						'Upload node_modules in SFTP mode (auto/true/false)',
						'false'
					),
					DEPLOY_RESTART_COMMAND: await ask(
						'DEPLOY_RESTART_COMMAND',
						'Remote restart command (SSH mode only)'
					),
					DEPLOY_HEALTH_URL: await ask(
						'DEPLOY_HEALTH_URL',
						'Public health check URL (optional, local only)'
					),
					DEPLOY_PUBLIC_ORIGIN: await ask(
						'DEPLOY_PUBLIC_ORIGIN',
						'Public origin behind proxy (optional, inferred from health URL)'
					),
					DEPLOY_BODY_SIZE_LIMIT: await ask(
						'DEPLOY_BODY_SIZE_LIMIT',
						'Runtime upload body limit in bytes',
						'10485760'
					),
					DEPLOY_REMOTE_NODE: await ask(
						'DEPLOY_REMOTE_NODE',
						'Remote Node binary used by remote:* scripts',
						'/opt/plesk/node/22/bin/node'
					),
					DEPLOY_REMOTE_NPM: await ask(
						'DEPLOY_REMOTE_NPM',
						'Remote npm binary used by remote:install',
						'/opt/plesk/node/22/bin/npm'
					)
				};
				remoteSetup = () => setupSftpRemote(sftpConfig, sftpConfigPath);
			}
		}

		if (!values) {
			values = {
				DEPLOY_TRANSPORT: 'ssh',
				DEPLOY_SSH_TARGET: await ask(
					'DEPLOY_SSH_TARGET',
					'SSH host alias (optional; leave blank if setting host/user)'
				),
				DEPLOY_HOST: await ask('DEPLOY_HOST', 'SSH host (optional when using alias)'),
				DEPLOY_USER: await ask('DEPLOY_USER', 'SSH username (optional when using alias)'),
				DEPLOY_PORT: await ask('DEPLOY_PORT', 'SSH port', '22'),
				DEPLOY_PATH: await ask('DEPLOY_PATH', 'Remote application root path'),
				DEPLOY_BASE_PATH: await ask('DEPLOY_BASE_PATH', 'Public base path only, not a full URL'),
				DEPLOY_SSH_KEY: await ask('DEPLOY_SSH_KEY', 'SSH key path (optional)'),
				DEPLOY_INSTALL_COMMAND: await ask(
					'DEPLOY_INSTALL_COMMAND',
					'Remote install command',
					'npm ci --omit=dev'
				),
				DEPLOY_RESTART_COMMAND: await ask(
					'DEPLOY_RESTART_COMMAND',
					'Remote restart command (optional)'
				),
				DEPLOY_HEALTH_URL: await ask(
					'DEPLOY_HEALTH_URL',
					'Public health check URL (optional, local only)'
				),
				DEPLOY_PUBLIC_ORIGIN: await ask(
					'DEPLOY_PUBLIC_ORIGIN',
					'Public origin behind proxy (optional, inferred from health URL)'
				),
				DEPLOY_BODY_SIZE_LIMIT: await ask(
					'DEPLOY_BODY_SIZE_LIMIT',
					'Runtime upload body limit in bytes',
					'10485760'
				)
			};
			remoteSetup = () => setupSshRemote(values);
		}

		validateBasePath(values.DEPLOY_BASE_PATH);
		await upsertEnv(values);
		console.log('.env.local updated. It is ignored by git.');

		if (!args.has('--skip-install')) {
			await run(npmCommand(), ['install'], { label: 'npm install' });
		}

		if (!args.has('--skip-remote')) {
			await remoteSetup();
		}

		console.log('Setup complete. Run npm run upload when you are ready to publish.');
	} finally {
		rl.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
