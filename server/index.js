const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const si = require('systeminformation');
const chokidar = require('chokidar');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- SYSTEM MONITORING ---
setInterval(async () => {
    const [cpu, mem, fsSize] = await Promise.all([si.currentLoad(), si.mem(), si.fsSize()]);
    io.emit('stats', {
        cpu: cpu.currentLoad.toFixed(1),
        ram: (mem.active / 1024 / 1024 / 1024).toFixed(2),
        storage: fsSize.find(f => f.mount === '/').use.toFixed(1)
    });
}, 1000);

// --- FILE EXPLORER API ---
app.get('/api/files/list', async (req, res) => {
    const targetPath = req.query.path || '/';
    try {
        const files = await fs.readdir(targetPath, { withFileTypes: true });
        const result = files.map(file => ({
            name: file.name,
            isDir: file.isDirectory(),
            path: path.join(targetPath, file.name)
        }));
        res.json(result);
    } catch (err) { res.status(500).json({ error: "Access Denied" }); }
});

app.get('/api/files/read', async (req, res) => {
    try {
        const content = await fs.readFile(req.query.path, 'utf-8');
        res.json({ content });
    } catch (err) { res.status(500).json({ error: "Cannot read file" }); }
});

server.listen(3005, () => console.log('Enclave-OS API live on 3005'));