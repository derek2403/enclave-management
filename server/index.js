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

const HOST_ROOT = '/host';
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

async function collectStats() {
    try {
        const [cpu, cpuTemp, mem, fsSize, networkStats] = await Promise.all([
            si.currentLoad(),
            si.cpuTemperature(),
            si.mem(),
            si.fsSize(),
            si.networkStats(),
        ]);
        const disk = fsSize.find(f => f.mount === '/host') || fsSize.find(f => f.mount === '/') || fsSize[0];
        const net = networkStats[0] || {};

        cachedStats = {
            cpu: parseFloat(cpu.currentLoad.toFixed(1)),
            cpuCores: os.cpus().length,
            cpuModel: os.cpus()[0]?.model || 'Unknown',
            cpuTemp: cpuTemp.main || null,
            cpuTempMax: cpuTemp.max || null,
            ram: parseFloat((mem.active / 1024 / 1024 / 1024).toFixed(2)),
            ramTotal: parseFloat((mem.total / 1024 / 1024 / 1024).toFixed(1)),
            ramPercent: parseFloat(((mem.active / mem.total) * 100).toFixed(1)),
            swap: parseFloat((mem.swapused / 1024 / 1024 / 1024).toFixed(2)),
            swapTotal: parseFloat((mem.swaptotal / 1024 / 1024 / 1024).toFixed(1)),
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

// --- FILE API ---

// List directory (browsing host filesystem)
app.get('/api/files/list', async (req, res) => {
    const resolved = safePath(req.query.path || '', HOST_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const files = await Promise.all(entries
            .filter(f => !f.name.startsWith('.')) // hide dotfiles by default unless requested
            .map(async (f) => {
                const fullPath = path.join(resolved, f.name);
                const relativePath = path.relative(HOST_ROOT, fullPath);
                let stat = null;
                try { stat = await fs.stat(fullPath); } catch (e) {}
                return {
                    name: f.name,
                    isDir: f.isDirectory(),
                    path: relativePath,
                    size: stat?.size || 0,
                    modified: stat?.mtime || null,
                };
            }));
        res.json(files);
    } catch (err) { res.status(500).json({ error: "Cannot read directory" }); }
});

// List with hidden files
app.get('/api/files/list-all', async (req, res) => {
    const resolved = safePath(req.query.path || '', HOST_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        const entries = await fs.readdir(resolved, { withFileTypes: true });
        const files = await Promise.all(entries.map(async (f) => {
            const fullPath = path.join(resolved, f.name);
            const relativePath = path.relative(HOST_ROOT, fullPath);
            let stat = null;
            try { stat = await fs.stat(fullPath); } catch (e) {}
            return {
                name: f.name,
                isDir: f.isDirectory(),
                path: relativePath,
                size: stat?.size || 0,
                modified: stat?.mtime || null,
            };
        }));
        res.json(files);
    } catch (err) { res.status(500).json({ error: "Cannot read directory" }); }
});

// Read file content
app.get('/api/files/read', async (req, res) => {
    const resolved = safePath(req.query.path, HOST_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        const stat = await fs.stat(resolved);
        if (stat.size > 5 * 1024 * 1024) return res.status(413).json({ error: "File too large (max 5MB)" });
        const content = await fs.readFile(resolved, 'utf-8');
        res.json({ content, size: stat.size, modified: stat.mtime });
    } catch (err) { res.status(500).json({ error: "Cannot read file" }); }
});

// Write/save file (projects only — host is read-only)
app.put('/api/files/write', async (req, res) => {
    const resolved = safePath(req.body.path, HOST_ROOT);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        await fs.writeFile(resolved, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot write file (may be read-only)" }); }
});

// Create file or directory
app.post('/api/files/create', async (req, res) => {
    const resolved = safePath(req.body.path, HOST_ROOT);
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
    const resolved = safePath(req.body.path, HOST_ROOT);
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
    const oldPath = safePath(req.body.oldPath, HOST_ROOT);
    const newPath = safePath(req.body.newPath, HOST_ROOT);
    if (!oldPath || !newPath) return res.status(403).json({ error: "Forbidden" });
    try {
        await fs.rename(oldPath, newPath);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot rename" }); }
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
