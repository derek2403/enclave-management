const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const pty = require('node-pty');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const HOST_ROOT = '/host';

// --- SYSTEM STATS ---
setInterval(async () => {
    const [cpu, mem, fsSize] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    io.emit('stats', {
        cpu: cpu.currentLoad.toFixed(1),
        ram: (mem.active / 1024 / 1024 / 1024).toFixed(2),
        storage: fsSize.find(f => f.mount === '/host')?.use.toFixed(1) || 0
    });
}, 1000);

// --- FILE API ---
app.get('/api/files/list', async (req, res) => {
    const safePath = path.join(HOST_ROOT, req.query.path || '/');
    try {
        const files = await fs.readdir(safePath, { withFileTypes: true });
        res.json(files.map(f => ({
            name: f.name, isDir: f.isDirectory(),
            path: path.relative(HOST_ROOT, path.join(safePath, f.name))
        })));
    } catch (err) { res.status(500).json({ error: "Access Denied" }); }
});

// --- TERMINAL LOGIC ---
io.on('connection', (socket) => {
    const shell = pty.spawn('bash', [], {
        name: 'xterm-color',
        cwd: '/app/projects', // Start terminal in your projects folder
        env: process.env
    });

    shell.onData(data => socket.emit('terminal_output', data));
    socket.on('terminal_input', data => shell.write(data));
    socket.on('disconnect', () => shell.kill());
});

server.listen(3005, '0.0.0.0');