#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const skipBuild = args.has('--skip-build');
const keepStage = args.has('--keep-stage');
const stageOnly = args.has('--stage-only');

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

async function loadEnv() {
	const env = {};

	for (const filename of ['.env', '.env.deploy', '.env.local']) {
		const filePath = path.join(root, filename);
		if (await fileExists(filePath)) Object.assign(env, parseEnv(await readFile(filePath, 'utf-8')));
	}

	return { ...env, ...process.env };
}

function requireValue(env, key) {
	const value = String(env[key] ?? '').trim();
	if (!value) throw new Error(`${key} is required. Run npm run setup first.`);
	return value;
}

function requireConfigValue(config, key, source) {
	const value = config?.[key];
	if (value === undefined || value === null || String(value).trim() === '') {
		throw new Error(`${key} is missing from ${source}.`);
	}

	return value;
}

function shellQuote(value) {
	return `'${String(value).replace(/'/g, "'\\''")}'`;
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

function releaseName() {
	return new Date()
		.toISOString()
		.replace(/[-:.TZ]/g, '')
		.slice(0, 14);
}

function sshTarget(env) {
	if (env.DEPLOY_SSH_TARGET) return String(env.DEPLOY_SSH_TARGET).trim();
	const host = requireValue(env, 'DEPLOY_HOST');
	const user = requireValue(env, 'DEPLOY_USER');
	return `${user}@${host}`;
}

function sshArgs(env, forScp = false) {
	const options = [];
	const port = String(env.DEPLOY_PORT ?? '').trim();

	if (port && port !== '22') {
		options.push(forScp ? '-P' : '-p', port);
	}

	if (env.DEPLOY_SSH_KEY) {
		options.push('-i', String(env.DEPLOY_SSH_KEY));
	}

	return options;
}

function scpRemote(target, remotePath) {
	return `${target}:${shellQuote(`${remotePath}/`)}`;
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

function envFlag(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function nodeModulesUploadMode(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;

	const normalized = String(value).trim().toLowerCase();
	if (normalized === 'auto') return 'auto';
	if (['1', 'true', 'yes', 'on', 'always'].includes(normalized)) return 'always';
	if (['0', 'false', 'no', 'off', 'never'].includes(normalized)) return 'never';
	throw new Error('DEPLOY_UPLOAD_NODE_MODULES must be "auto", "true", or "false".');
}

async function run(command, commandArgs, options = {}) {
	const label = options.label ?? [command, ...commandArgs].join(' ');
	console.log(`> ${label}`);

	if (dryRun) return 0;
	const spawnTarget = spawnCommand(command, commandArgs);

	return await new Promise((resolve, reject) => {
		const child = spawn(spawnTarget.command, spawnTarget.commandArgs, {
			cwd: options.cwd ?? root,
			env: { ...process.env, ...(options.env ?? {}) },
			stdio: options.input ? ['pipe', 'inherit', 'inherit'] : 'inherit'
		});

		if (options.input) child.stdin.end(options.input);

		child.on('error', reject);
		child.on('exit', (code) => {
			if (code === 0) {
				resolve(0);
				return;
			}

			reject(new Error(`${label} failed with exit code ${code}`));
		});
	});
}

function nodeRuntimeEnv(publicOrigin, bodySizeLimit) {
	return [
		publicOrigin ? `process.env.ORIGIN ||= ${JSON.stringify(publicOrigin)};` : '',
		bodySizeLimit ? `process.env.BODY_SIZE_LIMIT ||= ${JSON.stringify(bodySizeLimit)};` : ''
	]
		.filter(Boolean)
		.join('\n');
}

function passengerStartupFile(publicOrigin, bodySizeLimit) {
	return `process.env.NODE_ENV ||= 'production';
${nodeRuntimeEnv(publicOrigin, bodySizeLimit)}

async function main() {
\tawait import('./build/index.js');
}

main().catch((error) => {
\tconsole.error(error);
\tprocess.exit(1);
});
`;
}

function esmStartupFile(publicOrigin, bodySizeLimit) {
	return `process.env.NODE_ENV ||= 'production';
${nodeRuntimeEnv(publicOrigin, bodySizeLimit)}

await import('./build/index.js');
`;
}

function passengerHtaccessFile(remoteRoot, basePath) {
	const lines = [
		'PassengerEnabled on',
		'PassengerAppType node',
		`PassengerAppRoot ${remoteRoot}`,
		'PassengerStartupFile _passenger.cjs'
	];

	if (basePath && basePath !== '/') {
		lines.push(`PassengerBaseURI ${basePath}`);
	}

	return `${lines.join('\n')}\n`;
}

async function installProductionModules(stageDir) {
	await run(npmCommand(), ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
		cwd: stageDir,
		label: 'npm ci --omit=dev in deploy stage'
	});
}

async function stageRelease(stageDir, options = {}) {
	await rm(stageDir, { recursive: true, force: true });
	await mkdir(stageDir, { recursive: true });

	await cp(path.join(root, 'build'), path.join(stageDir, 'build'), { recursive: true });
	await cp(path.join(root, 'package.json'), path.join(stageDir, 'package.json'));
	await cp(path.join(root, 'package-lock.json'), path.join(stageDir, 'package-lock.json'));

	if (options.passenger) {
		await writeFile(
			path.join(stageDir, '_passenger.cjs'),
			passengerStartupFile(options.publicOrigin, options.bodySizeLimit),
			'utf-8'
		);
		await writeFile(
			path.join(stageDir, 'app.js'),
			esmStartupFile(options.publicOrigin, options.bodySizeLimit),
			'utf-8'
		);
		await writeFile(
			path.join(stageDir, 'server.js'),
			esmStartupFile(options.publicOrigin, options.bodySizeLimit),
			'utf-8'
		);

		if (options.writeHtaccess) {
			await writeFile(
				path.join(stageDir, '.htaccess'),
				passengerHtaccessFile(options.remoteRoot, options.basePath),
				'utf-8'
			);
		}
	}

	if (options.includeNodeModules) {
		await installProductionModules(stageDir);
	}
}

async function uploadWithSsh(env, stageDir, installCommand, restartCommand) {
	const target = sshTarget(env);
	const remoteRoot = trimTrailingSlash(requireValue(env, 'DEPLOY_PATH'));
	const release = releaseName();
	const releaseDir = `${remoteRoot}/releases/${release}`;
	const sharedData = `${remoteRoot}/shared/data`;
	const currentLink = `${remoteRoot}/current`;

	const remotePrep = `
set -eu
mkdir -p ${shellQuote(releaseDir)}
mkdir -p ${shellQuote(`${sharedData}/documents`)}
`;

	await run('ssh', [...sshArgs(env), target, 'sh', '-s'], {
		input: remotePrep,
		label: 'ssh prepare remote release'
	});

	await run(
		'scp',
		[
			...sshArgs(env, true),
			'-r',
			path.join(stageDir, 'build'),
			path.join(stageDir, 'package.json'),
			path.join(stageDir, 'package-lock.json'),
			scpRemote(target, releaseDir)
		],
		{ label: 'scp upload runtime files' }
	);

	const activate = `
set -eu
release_dir=${shellQuote(releaseDir)}
shared_data=${shellQuote(sharedData)}
current_link=${shellQuote(currentLink)}
install_command=${shellQuote(installCommand)}
restart_command=${shellQuote(restartCommand)}

cd "$release_dir"
rm -rf data
ln -sfn "$shared_data" data

if [ -n "$install_command" ]; then
	sh -lc "$install_command"
fi

ln -sfn "$release_dir" "$current_link"

if [ -n "$restart_command" ]; then
	cd "$current_link"
	sh -lc "$restart_command"
else
	printf '%s\\n' "Upload complete. No DEPLOY_RESTART_COMMAND was configured."
	printf '%s\\n' "Start manually from: $current_link"
fi
`;

	await run('ssh', [...sshArgs(env), target, 'sh', '-s'], {
		input: activate,
		label: 'ssh install and activate release'
	});
}

async function removeRemoteDir(client, remotePath) {
	const exists = await client.exists(remotePath);
	if (exists) await client.rmdir(remotePath, true);
}

function comparablePackageLock(lock) {
	delete lock.version;
	if (lock.packages?.['']) delete lock.packages[''].version;
	return lock;
}

async function remoteDependenciesMatch(client, remotePath, localPath) {
	if (!(await client.exists(remotePath))) return false;

	try {
		const [remoteData, localData] = await Promise.all([
			client.get(remotePath),
			readFile(localPath)
		]);
		const remoteBuffer = Buffer.isBuffer(remoteData)
			? remoteData
			: Buffer.from(String(remoteData), 'utf-8');

		const remoteLock = comparablePackageLock(JSON.parse(remoteBuffer.toString('utf-8')));
		const localLock = comparablePackageLock(JSON.parse(localData.toString('utf-8')));
		return JSON.stringify(remoteLock) === JSON.stringify(localLock);
	} catch {
		return false;
	}
}

async function shouldUploadNodeModules(client, remoteRoot, stageDir, mode, cleanNodeModules) {
	const localNodeModules = path.join(stageDir, 'node_modules');
	if (!(await fileExists(localNodeModules))) return false;
	if (mode === 'never') return false;
	if (mode === 'always' || cleanNodeModules) return true;

	const remoteNodeModules = remoteJoin(remoteRoot, 'node_modules');
	if (!(await client.exists(remoteNodeModules))) {
		console.log('Remote node_modules missing; uploading production dependencies.');
		return true;
	}

	const packageLockMatches = await remoteDependenciesMatch(
		client,
		remoteJoin(remoteRoot, 'package-lock.json'),
		path.join(stageDir, 'package-lock.json')
	);

	if (!packageLockMatches) {
		console.log('Remote dependency lock differs; uploading production dependencies.');
		return true;
	}

	console.log('Skipping node_modules upload; remote dependencies already match.');
	return false;
}

async function removeGeneratedHtaccess(client, remotePath) {
	const exists = await client.exists(remotePath);
	if (!exists) return;

	try {
		const data = await client.get(remotePath);
		const text = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
		if (!text.includes('PassengerStartupFile') && !text.includes('PassengerEnabled')) return;
		await client.delete(remotePath);
		console.log('Removed generated .htaccess because DEPLOY_WRITE_HTACCESS is disabled.');
	} catch {
		console.log('Could not inspect existing .htaccess; leaving it untouched.');
	}
}

async function uploadWithSftp(
	config,
	configPath,
	stageDir,
	installCommand,
	restartCommand,
	options = {}
) {
	const { default: SftpClient } = await import('ssh2-sftp-client');
	const source = path.relative(root, configPath) || configPath;
	const remoteRoot = trimTrailingSlash(String(requireConfigValue(config, 'remotePath', source)));
	const client = new SftpClient('intr-deploy');

	console.log(`Using local SFTP config from ${source}.`);

	if (dryRun) {
		console.log('> sftp upload runtime files');
		return;
	}

	await client.connect(await sftpConnectionConfig(config, source));

	try {
		await client.mkdir(remoteRoot, true);
		await client.mkdir(remoteJoin(remoteRoot, 'data', 'documents'), true);
		console.log('Uploading build files...');
		await removeRemoteDir(client, remoteJoin(remoteRoot, 'build'));

		const uploadNodeModules = await shouldUploadNodeModules(
			client,
			remoteRoot,
			stageDir,
			options.nodeModulesUploadMode ?? 'never',
			options.cleanNodeModules
		);

		if (options.cleanNodeModules && uploadNodeModules) {
			try {
				await removeRemoteDir(client, remoteJoin(remoteRoot, 'node_modules'));
			} catch {
				console.log('Could not clean remote node_modules; uploading over the existing folder.');
			}
		}
		await client.uploadDir(path.join(stageDir, 'build'), remoteJoin(remoteRoot, 'build'));
		if (uploadNodeModules) {
			console.log('Uploading production node_modules...');
			await client.uploadDir(
				path.join(stageDir, 'node_modules'),
				remoteJoin(remoteRoot, 'node_modules')
			);
		}
		console.log('Uploading runtime manifest files...');
		await client.put(path.join(stageDir, 'package.json'), remoteJoin(remoteRoot, 'package.json'));
		await client.put(
			path.join(stageDir, 'package-lock.json'),
			remoteJoin(remoteRoot, 'package-lock.json')
		);
		await client.put(
			path.join(stageDir, '_passenger.cjs'),
			remoteJoin(remoteRoot, '_passenger.cjs')
		);
		await client.put(path.join(stageDir, 'app.js'), remoteJoin(remoteRoot, 'app.js'));
		await client.put(path.join(stageDir, 'server.js'), remoteJoin(remoteRoot, 'server.js'));
		if (await fileExists(path.join(stageDir, '.htaccess'))) {
			await client.put(path.join(stageDir, '.htaccess'), remoteJoin(remoteRoot, '.htaccess'));
		} else {
			await removeGeneratedHtaccess(client, remoteJoin(remoteRoot, '.htaccess'));
		}
		await client.mkdir(remoteJoin(remoteRoot, 'tmp'), true);
		await client.put(
			Buffer.from(`${new Date().toISOString()}\n`),
			remoteJoin(remoteRoot, 'tmp', 'restart.txt')
		);
	} finally {
		await client.end();
	}

	if (installCommand || restartCommand) {
		console.log('SFTP mode uploaded files only. Remote install/restart commands require SSH mode.');
	}
}

async function waitForHealth(url) {
	if (!url) return;

	const attempts = 8;
	const waitMs = 2500;
	console.log('Checking deployed app health...');

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(url, { redirect: 'follow' });
			if (response.status < 400) {
				console.log(`Health check passed with HTTP ${response.status}.`);
				return;
			}
		} catch {
			// The app may still be restarting; retry below.
		}

		if (attempt < attempts) {
			await new Promise((resolve) => setTimeout(resolve, waitMs));
		}
	}

	console.log('Health check did not pass yet. The host may still be starting the Node app.');
}

async function main() {
	const env = await loadEnv();
	const sftpConfigPath = resolveProjectPath(
		env.DEPLOY_SFTP_CONFIG || path.join('.vscode', 'sftp.json')
	);
	const sftpConfig = await readJsonIfExists(sftpConfigPath);
	const transport = String(env.DEPLOY_TRANSPORT || (sftpConfig ? 'sftp' : 'ssh')).toLowerCase();
	const stageDir = path.join(root, '.deploy', releaseName());
	const basePath = String(
		env.DEPLOY_BASE_PATH ||
			(transport === 'sftp' ? inferBasePathFromRemotePath(sftpConfig?.remotePath) : '')
	).trim();
	const installCommand = String(
		env.DEPLOY_INSTALL_COMMAND ?? (transport === 'ssh' ? 'npm ci --omit=dev' : '')
	).trim();
	const restartCommand = String(env.DEPLOY_RESTART_COMMAND ?? '').trim();
	const uploadNodeModulesMode = nodeModulesUploadMode(
		env.DEPLOY_UPLOAD_NODE_MODULES,
		transport === 'sftp' ? 'auto' : 'never'
	);
	const includeNodeModules = uploadNodeModulesMode !== 'never';
	const cleanNodeModules = envFlag(env.DEPLOY_CLEAN_NODE_MODULES, false);
	const writeHtaccess = envFlag(env.DEPLOY_WRITE_HTACCESS, false);
	const healthUrl = String(env.DEPLOY_HEALTH_URL ?? '').trim();
	const publicOrigin = publicOriginFromUrl(env.DEPLOY_PUBLIC_ORIGIN || healthUrl);
	const bodySizeLimit = String(
		env.DEPLOY_BODY_SIZE_LIMIT || env.BODY_SIZE_LIMIT || '10485760'
	).trim();

	validateBasePath(basePath);

	if (!['sftp', 'ssh'].includes(transport)) {
		throw new Error('DEPLOY_TRANSPORT must be "sftp" or "ssh".');
	}

	if (transport === 'sftp' && !sftpConfig) {
		throw new Error(`${path.relative(root, sftpConfigPath)} was not found.`);
	}

	const sftpRemoteRoot =
		transport === 'sftp'
			? trimTrailingSlash(String(requireConfigValue(sftpConfig, 'remotePath', 'SFTP config')))
			: '';

	if (!skipBuild) {
		const buildEnv = {
			APP_DEPLOYED_AT: new Date().toISOString(),
			...(basePath && basePath !== '/' ? { BASE_PATH: basePath } : {})
		};
		await run(npmCommand(), ['run', 'build'], {
			env: buildEnv,
			label: basePath ? `BASE_PATH=${basePath} npm run build` : 'npm run build'
		});
	}

	if (!dryRun) {
		await stageRelease(stageDir, {
			includeNodeModules,
			passenger: transport === 'sftp',
			writeHtaccess,
			remoteRoot: sftpRemoteRoot,
			basePath,
			publicOrigin,
			bodySizeLimit
		});
	}
	console.log(`Staged runtime files in ${path.relative(root, stageDir)}`);

	if (stageOnly) {
		console.log('Stage-only mode complete. No files were uploaded.');
		return;
	}

	if (transport === 'sftp') {
		await uploadWithSftp(sftpConfig, sftpConfigPath, stageDir, installCommand, restartCommand, {
			cleanNodeModules,
			nodeModulesUploadMode: uploadNodeModulesMode
		});
	} else {
		await uploadWithSsh(env, stageDir, installCommand, restartCommand);
	}

	if (!dryRun) {
		await waitForHealth(healthUrl);
	}

	if (!keepStage && !dryRun) {
		await rm(stageDir, { recursive: true, force: true });
	}

	console.log('Deployment upload complete.');
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
