const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const pty = require('node-pty');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const os = require('os');

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));
app.use(express.json({ limit: '5mb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN, credentials: true } });

const HOST_ROOT = '/host';       // read-only full host filesystem (for stats)
const DATA_ROOT = '/data';       // read-write user home (/home/ubuntu)
const PROJECTS_ROOT = '/app/projects';

// Helper: resolve and validate path stays within a root
function safePath(userPath, root = HOST_ROOT) {
    if (!userPath && userPath !== '') return root;
    const cleaned = userPath.replace(/^\/+/, '');
    const resolved = path.join(root, cleaned);
    const normalised = path.normalize(resolved);
    if (!normalised.startsWith(root)) return null;
    return normalised;
}

// --- SYSTEM STATS ---
let cachedStats = {};

// Container resource limits from env vars (LXC limits aren't visible inside nested Docker)
const CONTAINER_CORES = parseInt(process.env.CONTAINER_CORES) || os.cpus().length;
const CONTAINER_RAM_BYTES = (parseFloat(process.env.CONTAINER_RAM_GB) || (os.totalmem() / (1024 * 1024 * 1024))) * 1024 * 1024 * 1024;

// Parse /proc/meminfo from the host mount to get LXC-level memory
async function getHostMemInfo() {
    try {
        const raw = await fs.readFile('/host/proc/meminfo', 'utf-8');
        const lines = {};
        raw.split('\n').forEach(line => {
            const match = line.match(/^(\w+):\s+(\d+)/);
            if (match) lines[match[1]] = parseInt(match[2]) * 1024; // kB to bytes
        });
        const total = lines.MemTotal || 0;
        const available = lines.MemAvailable || 0;
        const used = total - available;
        return { total, used, available };
    } catch (e) {
        return null;
    }
}

async function collectStats() {
    try {
        const [cpu, cpuTemp, fsSize, networkStats, hostMem] = await Promise.all([
            si.currentLoad(),
            si.cpuTemperature(),
            si.fsSize(),
            si.networkStats(),
            getHostMemInfo(),
        ]);
        const disk = fsSize.find(f => f.mount === '/host') || fsSize.find(f => f.mount === '/') || fsSize[0];
        const net = networkStats[0] || {};

        const ramTotalGB = CONTAINER_RAM_BYTES / (1024 * 1024 * 1024);
        // Scale CPU usage to container cores
        const cpuScaled = (cpu.currentLoad / os.cpus().length) * CONTAINER_CORES;
        // Use host's /proc/meminfo for accurate LXC memory (excludes cache/buffers)
        const ramUsedBytes = hostMem ? hostMem.used : 0;
        const ramUsedGB = Math.min(ramUsedBytes, CONTAINER_RAM_BYTES) / (1024 * 1024 * 1024);

        cachedStats = {
            cpu: parseFloat(Math.min(cpuScaled, 100).toFixed(1)),
            cpuCores: CONTAINER_CORES,
            cpuModel: os.cpus()[0]?.model || 'Unknown',
            cpuTemp: cpuTemp.main || null,
            cpuTempMax: cpuTemp.max || null,
            ram: parseFloat(ramUsedGB.toFixed(2)),
            ramTotal: parseFloat(ramTotalGB.toFixed(1)),
            ramPercent: parseFloat(((ramUsedGB / ramTotalGB) * 100).toFixed(1)),
            storageUsed: parseFloat(((disk?.used || 0) / 1024 / 1024 / 1024).toFixed(1)),
            storageTotal: parseFloat(((disk?.size || 0) / 1024 / 1024 / 1024).toFixed(1)),
            storagePercent: parseFloat(disk?.use?.toFixed(1) || 0),
            netUp: net.tx_sec ? parseFloat((net.tx_sec / 1024).toFixed(1)) : 0,
            netDown: net.rx_sec ? parseFloat((net.rx_sec / 1024).toFixed(1)) : 0,
            uptime: os.uptime(),
            hostname: os.hostname(),
            platform: `${os.type()} ${os.release()}`,
        };
        io.emit('stats', cachedStats);
    } catch (e) { /* ignore */ }
}

setInterval(collectStats, 1500);
collectStats();

// GET snapshot of stats (for initial load)
app.get('/api/stats', (req, res) => res.json(cachedStats));

// --- FILE API (all operations use DATA_ROOT = /data = /home/ubuntu on host) ---

function listDir(root, filterDots) {
    return async (req, res) => {
        const p = safePath(req.query.path || '', root);
        if (!p) return res.status(403).json({ error: "Forbidden" });
        try {
            const entries = await fs.readdir(p, { withFileTypes: true });
            const files = await Promise.all(
                entries.filter(f => !filterDots || !f.name.startsWith('.')).map(async (f) => {
                    const fullPath = path.join(p, f.name);
                    let stat = null;
                    try { stat = await fs.stat(fullPath); } catch (e) {}
                    return {
                        name: f.name,
                        isDir: f.isDirectory(),
                        path: path.relative(root, fullPath),
                        size: stat?.size || 0,
                        modified: stat?.mtime || null,
                    };
                }));
            res.json(files);
        } catch (err) { res.status(500).json({ error: "Cannot read directory" }); }
    };
}

app.get('/api/files/list', listDir(DATA_ROOT, true));
app.get('/api/files/list-all', listDir(DATA_ROOT, false));

// Read file content
app.get('/api/files/read', async (req, res) => {
    const resolved = safePath(req.query.path, DATA_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        const stat = await fs.stat(resolved);
        if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: "File too large (max 5MB)" });
        const content = await fs.readFile(resolved, 'utf-8');
        res.json({ content, size: stat.size, modified: stat.mtime });
    } catch (err) { res.status(500).json({ error: "Cannot read file" }); }
});

// Write/save file
app.put('/api/files/write', async (req, res) => {
    const resolved = safePath(req.body.path, DATA_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        await fs.writeFile(resolved, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot write file" }); }
});

// Create file or directory
app.post('/api/files/create', async (req, res) => {
    const resolved = safePath(req.body.path, DATA_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        if (req.body.isDir) {
            await fs.mkdir(resolved, { recursive: true });
        } else {
            await fs.writeFile(resolved, '', 'utf-8');
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot create" }); }
});

// Delete file or directory
app.delete('/api/files/delete', async (req, res) => {
    const resolved = safePath(req.body.path, DATA_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
            await fs.rm(resolved, { recursive: true });
        } else {
            await fs.unlink(resolved);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot delete" }); }
});

// Rename/move
app.put('/api/files/rename', async (req, res) => {
    const oldPath = safePath(req.body.oldPath, DATA_ROOT);
    const newPath = safePath(req.body.newPath, DATA_ROOT);
    if (!oldPath || !newPath) return res.status(403).json({ error: "Forbidden" });
    try {
        await fs.rename(oldPath, newPath);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot rename" }); }
});

// --- PROCESS API (reads from host /proc) ---

app.get('/api/processes', async (req, res) => {
    try {
        // Use ps from host's proc mount via nsenter or read /host/proc directly
        const hostProc = '/host/proc';
        const pids = (await fs.readdir(hostProc)).filter(f => /^\d+$/.test(f));
        const PAGE_SIZE = 4096;
        let procs = [];
        let running = 0;

        for (const pid of pids) {
            try {
                const stat = await fs.readFile(`${hostProc}/${pid}/stat`, 'utf-8');
                const cmdline = await fs.readFile(`${hostProc}/${pid}/cmdline`, 'utf-8').catch(() => '');
                const status = await fs.readFile(`${hostProc}/${pid}/status`, 'utf-8').catch(() => '');

                // Parse stat: pid (comm) state ...
                const match = stat.match(/^(\d+) \((.+?)\) (\S)/);
                if (!match) continue;

                const name = match[2];
                const state = match[3];
                if (state === 'R') running++;

                // Get RSS from stat fields (field 24, 0-indexed after splitting)
                const fields = stat.substring(stat.lastIndexOf(')') + 2).split(' ');
                const rssPages = parseInt(fields[21]) || 0; // field index 23 in full stat, 21 after comm+state
                const rssMB = (rssPages * PAGE_SIZE) / (1024 * 1024);

                // Get UID from status
                const uidMatch = status.match(/Uid:\s+(\d+)/);
                const uid = uidMatch ? uidMatch[1] : '0';

                const command = cmdline.replace(/\0/g, ' ').trim() || name;

                procs.push({
                    pid: parseInt(pid),
                    name,
                    command: command.substring(0, 120),
                    cpu: 0, // CPU % requires sampling two points, skip for now
                    mem: parseFloat(rssMB.toFixed(1)),
                    user: uid === '0' ? 'root' : uid,
                    state,
                });
            } catch (e) { continue; } // process may have exited
        }

        procs.sort((a, b) => b.mem - a.mem);
        const total = procs.length;
        procs = procs.slice(0, 50);

        res.json({ processes: procs, total, running });
    } catch (err) { res.status(500).json({ error: "Cannot list processes" }); }
});

app.post('/api/processes/kill', async (req, res) => {
    const { pid } = req.body;
    if (!pid) return res.status(400).json({ error: "PID required" });
    try {
        // Kill on the host by writing to /host/proc - but we can't actually signal host processes from inside Docker
        // Instead we use the terminal for kill commands. Return an error explaining this.
        res.status(400).json({ error: "Use the terminal to kill host processes: kill -9 " + pid });
    } catch (err) { res.status(500).json({ error: `Cannot kill process: ${err.message}` }); }
});

// --- DOCKER API ---
async function dockerRequest(socketPath, method, endpoint, body) {
    return new Promise((resolve, reject) => {
        const options = { socketPath, path: endpoint, method, headers: {} };
        if (body) {
            const data = JSON.stringify(body);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(data);
        }
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
                catch { resolve({ status: res.statusCode, data: data }); }
            });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

const DOCKER_SOCK = '/var/run/docker.sock';

app.get('/api/docker/containers', async (req, res) => {
    try {
        const { data } = await dockerRequest(DOCKER_SOCK, 'GET', '/containers/json?all=true');
        const containers = data.map(c => ({
            id: c.Id.substring(0, 12),
            name: (c.Names[0] || '').replace(/^\//, ''),
            image: c.Image,
            state: c.State,
            status: c.Status,
            ports: (c.Ports || []).map(p => p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}`).filter(Boolean),
            created: c.Created,
        }));
        res.json(containers);
    } catch (err) { res.status(500).json({ error: "Cannot connect to Docker" }); }
});

app.post('/api/docker/:action/:id', async (req, res) => {
    const { action, id } = req.params;
    const allowed = ['start', 'stop', 'restart', 'pause', 'unpause'];
    if (!allowed.includes(action)) return res.status(400).json({ error: "Invalid action" });
    try {
        const { status } = await dockerRequest(DOCKER_SOCK, 'POST', `/containers/${id}/${action}`);
        if (status < 300) res.json({ success: true });
        else res.status(status).json({ error: `Docker returned ${status}` });
    } catch (err) { res.status(500).json({ error: "Docker action failed" }); }
});

app.get('/api/docker/logs/:id', async (req, res) => {
    try {
        const tail = req.query.tail || 100;
        const { data } = await dockerRequest(DOCKER_SOCK, 'GET', `/containers/${req.params.id}/logs?stdout=true&stderr=true&tail=${tail}`);
        // Docker logs have 8-byte header per line, strip it for display
        const clean = typeof data === 'string' ? data.replace(/[\x00-\x08]/g, '') : JSON.stringify(data);
        res.json({ logs: clean });
    } catch (err) { res.status(500).json({ error: "Cannot get logs" }); }
});

app.get('/api/docker/stats/:id', async (req, res) => {
    try {
        const { data } = await dockerRequest(DOCKER_SOCK, 'GET', `/containers/${req.params.id}/stats?stream=false`);
        const cpuDelta = data.cpu_stats?.cpu_usage?.total_usage - data.precpu_stats?.cpu_usage?.total_usage;
        const systemDelta = data.cpu_stats?.system_cpu_usage - data.precpu_stats?.system_cpu_usage;
        const cpuPercent = systemDelta > 0 ? ((cpuDelta / systemDelta) * (data.cpu_stats?.online_cpus || 1) * 100).toFixed(1) : 0;
        const memUsage = data.memory_stats?.usage || 0;
        const memLimit = data.memory_stats?.limit || 1;
        res.json({
            cpu: parseFloat(cpuPercent),
            mem: parseFloat((memUsage / 1024 / 1024).toFixed(1)),
            memLimit: parseFloat((memLimit / 1024 / 1024).toFixed(1)),
            memPercent: parseFloat(((memUsage / memLimit) * 100).toFixed(1)),
        });
    } catch (err) { res.status(500).json({ error: "Cannot get stats" }); }
});

// --- TERMINAL LOGIC ---
io.on('connection', (socket) => {
    const shell = pty.spawn('bash', [], {
        name: 'xterm-color',
        cwd: PROJECTS_ROOT,
        env: process.env
    });

    shell.onData(data => socket.emit('terminal_output', data));
    socket.on('terminal_input', data => shell.write(data));
    socket.on('terminal_resize', ({ cols, rows }) => {
        try { shell.resize(cols, rows); } catch (e) {}
    });
    socket.on('disconnect', () => shell.kill());
});

server.listen(3005, '0.0.0.0');
