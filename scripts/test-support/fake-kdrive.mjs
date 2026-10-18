// In-memory imitation of the kDrive API endpoints used by INTR, for tests only.
// Mirrors the shapes from Infomaniak's MCP server: { result, data, has_more, cursor }, page size 10.
import http from 'node:http';

export function startFakeKdrive({ port = 0, driveId = '42', token = 'test-token', pageSize = 10 } = {}) {
	let nextId = 100;
	const nodes = new Map(); // id -> { id, name, type, parent_id, data?, versions }
	const trash = [];
	nodes.set(1, { id: 1, name: 'root', type: 'dir', parent_id: 0 });
	const appFolder = { id: nextId++, name: 'INTR', type: 'dir', parent_id: 1 };
	nodes.set(appFolder.id, appFolder);
	const stats = { uploads: 0, replaced: 0, downloads: 0, lists: 0 };
	const state = { token };

	const meta = (n) => ({ id: n.id, name: n.name, type: n.type, size: n.data?.length ?? 0, parent_id: n.parent_id });
	const send = (res, status, body) => {
		res.writeHead(status, { 'content-type': 'application/json' });
		res.end(JSON.stringify(body));
	};
	const children = (id) => [...nodes.values()].filter((n) => n.parent_id === id);

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url, 'http://x');
		if (req.headers.authorization !== `Bearer ${state.token}`) return send(res, 401, { result: 'error', error: { code: 'not_authorized', description: 'Authorization required' } });
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = Buffer.concat(chunks);
		let m;
		if (req.method === 'GET' && (m = url.pathname.match(`^/3/drive/${driveId}/files/(\\d+)/files$`))) {
			stats.lists++;
			const all = children(Number(m[1])).sort((a, b) => a.id - b.id);
			const start = Number(url.searchParams.get('cursor') || 0);
			const page = all.slice(start, start + pageSize); // ignores `limit` on purpose: worst case
			const more = start + pageSize < all.length;
			return send(res, 200, { result: 'success', data: page.map(meta), has_more: more, cursor: more ? String(start + pageSize) : null });
		}
		if (req.method === 'GET' && url.pathname === `/2/drive/${driveId}`) {
			return send(res, 200, { result: 'success', data: { id: Number(driveId), name: 'kDrive test' } });
		}
		if (req.method === 'GET' && (m = url.pathname.match(`^/3/drive/${driveId}/files/(\\d+)$`))) {
			const n = nodes.get(Number(m[1]));
			if (!n) return send(res, 404, { result: 'error', error: { code: 'object_not_found' } });
			return send(res, 200, { result: 'success', data: meta(n) });
		}
		if (req.method === 'POST' && (m = url.pathname.match(`^/3/drive/${driveId}/files/(\\d+)/directory$`))) {
			const { name } = JSON.parse(body.toString());
			const n = { id: nextId++, name, type: 'dir', parent_id: Number(m[1]) };
			nodes.set(n.id, n);
			return send(res, 200, { result: 'success', data: meta(n) });
		}
		if (req.method === 'POST' && url.pathname === `/3/drive/${driveId}/upload`) {
			stats.uploads++;
			if (Number(url.searchParams.get('total_size')) !== body.length) return send(res, 400, { result: 'error', error: { code: 'size_mismatch' } });
			const fileId = url.searchParams.get('file_id');
			if (fileId) {
				const n = nodes.get(Number(fileId));
				if (!n) return send(res, 404, { result: 'error', error: { code: 'object_not_found' } });
				n.versions = [...(n.versions ?? []), n.data];
				n.data = body;
				stats.replaced++;
				return send(res, 200, { result: 'success', data: meta(n) });
			}
			const parent = Number(url.searchParams.get('directory_id'));
			const name = url.searchParams.get('file_name');
			const existing = children(parent).find((n) => n.name === name && n.type === 'file');
			if (existing && url.searchParams.get('conflict') === 'version') {
				existing.versions = [...(existing.versions ?? []), existing.data];
				existing.data = body;
				return send(res, 200, { result: 'success', data: meta(existing) });
			}
			const n = { id: nextId++, name, type: 'file', parent_id: parent, data: body };
			nodes.set(n.id, n);
			return send(res, 200, { result: 'success', data: meta(n) });
		}
		if (req.method === 'POST' && (m = url.pathname.match(`^/3/drive/${driveId}/files/(\\d+)/move/(\\d+)$`))) {
			const n = nodes.get(Number(m[1]));
			const dest = nodes.get(Number(m[2]));
			if (!n || !dest || dest.type !== 'dir') return send(res, 404, { result: 'error', error: { code: 'object_not_found' } });
			if (children(dest.id).some((other) => other.id !== n.id && other.name === n.name)) {
				return send(res, 409, { result: 'error', error: { code: 'conflict_error', description: 'File already exists' } });
			}
			n.parent_id = dest.id;
			stats.moves = (stats.moves ?? 0) + 1;
			return send(res, 200, { result: 'success', data: meta(n) });
		}
		if (req.method === 'POST' && (m = url.pathname.match(`^/2/drive/${driveId}/files/(\\d+)/rename$`))) {
			const n = nodes.get(Number(m[1]));
			if (!n) return send(res, 404, { result: 'error', error: { code: 'object_not_found' } });
			const { name } = JSON.parse(body.toString());
			if (children(n.parent_id).some((other) => other.id !== n.id && other.name === name)) {
				return send(res, 409, { result: 'error', error: { code: 'conflict_error', description: 'File already exists' } });
			}
			n.name = name;
			return send(res, 200, { result: 'success', data: meta(n) });
		}
		if (req.method === 'GET' && (m = url.pathname.match(`^/2/drive/${driveId}/files/(\\d+)/download$`))) {
			stats.downloads++;
			const n = nodes.get(Number(m[1]));
			if (!n || n.type !== 'file') return send(res, 404, { result: 'error' });
			res.writeHead(200, { 'content-type': 'application/octet-stream' });
			return res.end(n.data);
		}
		if (req.method === 'DELETE' && (m = url.pathname.match(`^/2/drive/${driveId}/files/(\\d+)$`))) {
			const n = nodes.get(Number(m[1]));
			if (!n) return send(res, 404, { result: 'error' });
			nodes.delete(n.id);
			trash.push(n);
			return send(res, 200, { result: 'success', data: true });
		}
		send(res, 404, { result: 'error', error: { code: 'route_not_found', path: url.pathname } });
	});

	const addDir = (parentId, name) => {
		const n = { id: nextId++, name, type: 'dir', parent_id: parentId };
		nodes.set(n.id, n);
		return n;
	};
	const addFile = (parentId, name, data) => {
		const n = { id: nextId++, name, type: 'file', parent_id: parentId, data: Buffer.from(data) };
		nodes.set(n.id, n);
		return n;
	};
	const move = (id, parentId) => {
		nodes.get(id).parent_id = parentId;
	};

	return new Promise((resolve) =>
		server.listen(port, '127.0.0.1', () =>
			resolve({ server, port: server.address().port, driveId, token, appFolderId: appFolder.id, nodes, trash, stats, children, addDir, addFile, move, pathOf: (id) => { const parts = []; let n = nodes.get(id); while (n && n.id !== 1) { parts.unshift(n.name); n = nodes.get(n.parent_id); } return parts.join('/'); }, setToken: (value) => { state.token = value; } })
		)
	);
}
