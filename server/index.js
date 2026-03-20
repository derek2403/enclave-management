const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const pty = require('node-pty');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
}));
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CORS_ORIGIN, credentials: true } });

const HOST_ROOT = '/host';

// Helper: resolve and validate path stays within HOST_ROOT
function safePath(userPath) {
    const resolved = path.resolve(HOST_ROOT, userPath || '/');
    if (!resolved.startsWith(HOST_ROOT)) return null;
    return resolved;
}

// --- SYSTEM STATS ---
setInterval(async () => {
    try {
        const [cpu, mem, fsSize] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
        const totalRam = (mem.total / 1024 / 1024 / 1024).toFixed(1);
        const usedRam = (mem.active / 1024 / 1024 / 1024).toFixed(2);
        const disk = fsSize.find(f => f.mount === '/host') || fsSize[0];
        io.emit('stats', {
            cpu: cpu.currentLoad.toFixed(1),
            ram: usedRam,
            ramTotal: totalRam,
            storage: disk?.use?.toFixed(1) || 0,
            storageUsed: ((disk?.used || 0) / 1024 / 1024 / 1024).toFixed(1),
            storageTotal: ((disk?.size || 0) / 1024 / 1024 / 1024).toFixed(1),
        });
    } catch (e) { /* ignore stats errors */ }
}, 1000);

// --- FILE API ---

// List directory
app.get('/api/files/list', async (req, res) => {
    const resolved = safePath(req.query.path);
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
    const resolved = safePath(req.query.path);
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
    const resolved = safePath(req.body.path);
    if (!resolved) return res.status(403).json({ error: "Forbidden" });
    try {
        await fs.writeFile(resolved, req.body.content, 'utf-8');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: "Cannot write file" }); }
});

// Create file or directory
app.post('/api/files/create', async (req, res) => {
    const resolved = safePath(req.body.path);
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
    const resolved = safePath(req.body.path);
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

// Rename/move file or directory
app.put('/api/files/rename', async (req, res) => {
    const oldPath = safePath(req.body.oldPath);
    const newPath = safePath(req.body.newPath);
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
        cwd: '/app/projects',
        env: process.env
    });

    shell.onData(data => socket.emit('terminal_output', data));
    socket.on('terminal_input', data => shell.write(data));
    socket.on('disconnect', () => shell.kill());
});

server.listen(3005, '0.0.0.0');
