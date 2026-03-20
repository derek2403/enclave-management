# Enclave

A lightweight, self-hosted web dashboard for managing remote dev environments. Monitor system resources, browse files, edit code, manage Docker containers, and access a full terminal — all from your browser.

Built for developers who run their dev boxes on LXC containers, VPS, or bare metal servers.

![Dashboard](./docs/dashboard.png)

## Features

- **System Dashboard** — Real-time CPU, RAM, storage, temperature, network stats with circular gauges
- **File Manager** — Browse, create, rename, delete files and folders with search and hidden file toggle
- **Code Editor** — Open and edit files with line numbers, tab support, and Ctrl+S save
- **Web Terminal** — Full interactive terminal (bash) powered by xterm.js and node-pty
- **Process Manager** — View running processes sorted by memory/CPU, with kill support
- **Docker Management** — List containers, start/stop/restart/pause, view logs
- **Bento Grid Layout** — Clean, modern UI inspired by CasaOS

## Screenshots

| Dashboard | Terminal |
|-----------|----------|
| ![Dashboard](./docs/dashboard.png) | ![Terminal](./docs/terminal.png) |

| File Manager | Docker |
|--------------|--------|
| ![Files](./docs/files.png) | ![Docker](./docs/docker.png) |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A Linux server (LXC, VPS, or bare metal)

### 1. Clone the repo

```bash
git clone https://github.com/derek2403/enclave-management.git
cd enclave-management
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Domain Configuration
VITE_DASHBOARD_DOMAIN=your-dashboard.example.com
VITE_API_DOMAIN=your-api.example.com
CORS_ORIGIN=https://your-dashboard.example.com
NODE_ENV=production

# Container Resource Limits (match your server/LXC allocation)
CONTAINER_CORES=2
CONTAINER_RAM_GB=8

# Security
TERMINAL_USER=ubuntu
```

### 3. Deploy

```bash
docker compose up -d --build
```

The dashboard will be available at `http://your-server:5173` and the API at `http://your-server:3005`.

## Architecture

```
enclave-management/
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx      # Main application (all views)
│   │   └── index.css    # Tailwind + custom styles
│   └── Dockerfile       # Multi-stage build → serve
├── server/              # Node.js + Express backend
│   ├── index.js         # API server + WebSocket + terminal
│   └── Dockerfile       # node:20-slim + build tools
├── docker-compose.yml
└── .env
```

### How It Works

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, Vite 8, Tailwind CSS 4, xterm.js |
| Backend | Node.js 20, Express 5, Socket.IO, node-pty |
| System Stats | systeminformation + /proc parsing |
| Docker API | Direct Docker socket communication |
| File Manager | Host filesystem mounted as Docker volume |
| Terminal | PTY spawned via node-pty, streamed over WebSocket |

### Volume Mounts

| Mount | Container Path | Purpose |
|-------|---------------|---------|
| `/` (read-only) | `/host` | System stats, process listing |
| `/home/ubuntu` | `/data` | File manager (read/write) |
| `/home/ubuntu/projects` | `/app/projects` | Terminal working directory |
| `/var/run/docker.sock` | `/var/run/docker.sock` | Docker management |

## Reverse Proxy Setup

Enclave is designed to run behind a reverse proxy. Example with **Caddy**:

```
your-dashboard.example.com {
    reverse_proxy localhost:5173
}

your-api.example.com {
    reverse_proxy localhost:3005
}
```

For **Cloudflare Tunnel** or **Nginx Proxy Manager**, point your domains to the respective ports.

### Authentication

Enclave does not include built-in authentication. Protect it with:

- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) (recommended)
- [Authelia](https://www.authelia.com/)
- [Authentik](https://goauthentik.io/)
- HTTP Basic Auth via your reverse proxy

## Configuration

### Resource Limits

The dashboard reads `CONTAINER_CORES` and `CONTAINER_RAM_GB` from environment variables to display accurate stats when running inside LXC or other constrained environments. Set these to match your actual allocation:

```bash
# Check your actual limits
nproc          # CPU cores
free -h        # RAM
```

### Customizing Paths

Edit `docker-compose.yml` to change volume mounts:

```yaml
volumes:
  - /your/home:/data                    # File manager root
  - /your/projects:/app/projects        # Terminal start directory
```

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/stats` | System stats snapshot |
| GET | `/api/files/list?path=` | List directory |
| GET | `/api/files/list-all?path=` | List directory (including hidden) |
| GET | `/api/files/read?path=` | Read file content |
| PUT | `/api/files/write` | Write file content |
| POST | `/api/files/create` | Create file or directory |
| DELETE | `/api/files/delete` | Delete file or directory |
| PUT | `/api/files/rename` | Rename/move file |
| GET | `/api/processes` | List host processes |
| GET | `/api/docker/containers` | List Docker containers |
| POST | `/api/docker/:action/:id` | Start/stop/restart/pause container |
| GET | `/api/docker/logs/:id` | Get container logs |
| GET | `/api/docker/stats/:id` | Get container resource stats |

WebSocket events: `stats`, `terminal_output`, `terminal_input`, `terminal_resize`

## Roadmap

- [ ] Built-in authentication
- [ ] Monaco/CodeMirror code editor
- [ ] Mobile responsive layout
- [ ] Multi-terminal tabs
- [ ] Image/PDF preview in file manager
- [ ] Container log streaming (live)
- [ ] Configurable file manager root via UI
- [ ] Dark mode

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS, Lucide Icons, xterm.js
- **Backend**: Node.js, Express, Socket.IO, node-pty, systeminformation
- **Deployment**: Docker Compose

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

## License

MIT
