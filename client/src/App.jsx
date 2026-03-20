import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import {
  Terminal as TermIcon, Folder, FileText, ChevronRight, Cpu, Activity,
  HardDrive, Home, ArrowLeft, Trash2, Edit3, Save, X, FolderPlus,
  FilePlus, RefreshCw, MoreVertical, Eye, Search, Server, Clock,
  Thermometer, ArrowUpRight, ArrowDownLeft, MonitorSmartphone, Wifi,
  Box, ListTree, Play, Square, RotateCw, Pause, ScrollText, XCircle
} from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const API_URL = `https://${import.meta.env.VITE_API_DOMAIN}`;
const socket = io(API_URL, { withCredentials: true });
const fetchOpts = { credentials: 'include' };

function formatSize(bytes) {
  if (!bytes) return '—';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function formatUptime(s) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
function getFileIcon(name, isDir) {
  if (isDir) return <Folder size={18} className="text-blue-500" />;
  const ext = name.split('.').pop().toLowerCase();
  const code = ['js','jsx','ts','tsx','py','go','rs','java','c','cpp','h','css','html','json','yml','yaml','toml','xml','sh','bash','vue','svelte','rb','php'];
  const doc = ['md','txt','env','conf','cfg','ini','sql','log','csv'];
  if (code.includes(ext)) return <FileText size={18} className="text-violet-500" />;
  if (doc.includes(ext)) return <FileText size={18} className="text-emerald-500" />;
  return <FileText size={18} className="text-gray-400" />;
}

function CircularGauge({ value, max, label, color, icon, sub }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const r = 42, circ = 2 * Math.PI * r, offset = circ - (pct / 100) * circ;
  const colors = { blue: '#3b82f6', violet: '#8b5cf6', emerald: '#10b981', orange: '#f59e0b', red: '#ef4444' };
  const textColors = { blue: '#2563eb', violet: '#7c3aed', emerald: '#059669', orange: '#d97706', red: '#dc2626' };
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-[108px] h-[108px]">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#f1f5f9" strokeWidth="7" />
          <circle cx="50" cy="50" r={r} fill="none" stroke={colors[color] || colors.blue} strokeWidth="7"
            strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold" style={{ color: textColors[color] || textColors.blue }}>{pct.toFixed(0)}<span className="text-xs font-normal">%</span></span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold text-gray-700 flex items-center gap-1 justify-center">{icon}{label}</div>
        {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [stats, setStats] = useState({});
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [activeView, setActiveView] = useState('dashboard');
  const [showHidden, setShowHidden] = useState(false);
  const [editorFile, setEditorFile] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState(null);
  const [now, setNow] = useState(new Date());
  const [processes, setProcesses] = useState({ processes: [], total: 0, running: 0 });
  const [procSort, setProcSort] = useState('mem');
  const [containers, setContainers] = useState([]);
  const [dockerLogs, setDockerLogs] = useState(null);
  const termRef = useRef(null);
  const termInitRef = useRef(false);

  const notify = useCallback((msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/stats`, fetchOpts).then(r => r.json()).then(setStats).catch(() => {});
    socket.on('stats', setStats);
    return () => socket.off('stats');
  }, []);

  const fetchFiles = useCallback(async (p) => {
    const endpoint = showHidden ? 'list-all' : 'list';
    try {
      const res = await fetch(`${API_URL}/api/files/${endpoint}?path=${encodeURIComponent(p)}`, fetchOpts);
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      setFiles(data.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name)));
      setCurrentPath(p);
    } catch (e) { notify('Failed to load files', 'error'); }
  }, [notify, showHidden]);

  useEffect(() => {
    if (termInitRef.current) return;
    termInitRef.current = true;
    setTimeout(() => {
      const el = document.getElementById('terminal-box');
      if (!el) return;
      const term = new Terminal({
        cursorBlink: true,
        theme: { background: '#0f1117', foreground: '#e2e8f0', cursor: '#8b5cf6', selectionBackground: '#8b5cf644' },
        fontSize: 13, fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace', lineHeight: 1.5,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon); term.open(el); fitAddon.fit();
      socket.emit('terminal_resize', { cols: term.cols, rows: term.rows });
      const ro = new ResizeObserver(() => { fitAddon.fit(); socket.emit('terminal_resize', { cols: term.cols, rows: term.rows }); });
      ro.observe(el);
      socket.on('terminal_output', data => term.write(data));
      term.onData(data => socket.emit('terminal_input', data));
      termRef.current = term;
    }, 100);
    return () => { socket.off('terminal_output'); };
  }, []);

  // Processes
  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/processes`, fetchOpts);
      const data = await res.json();
      if (!data.error) setProcesses(data);
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (activeView !== 'processes') return;
    fetchProcesses();
    const t = setInterval(fetchProcesses, 3000);
    return () => clearInterval(t);
  }, [activeView, fetchProcesses]);

  const killProcess = async (pid) => {
    try {
      const res = await fetch(`${API_URL}/api/processes/kill`, {
        method: 'POST', ...fetchOpts, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid }),
      });
      const data = await res.json();
      if (data.error) notify(data.error, 'error');
      else { notify(`Process ${pid} killed`); fetchProcesses(); }
    } catch (e) { notify('Failed to kill process', 'error'); }
  };

  // Docker
  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/docker/containers`, fetchOpts);
      const data = await res.json();
      if (!data.error) setContainers(Array.isArray(data) ? data : []);
    } catch (e) {}
  }, []);

  useEffect(() => {
    if (activeView !== 'docker') return;
    fetchContainers();
    const t = setInterval(fetchContainers, 5000);
    return () => clearInterval(t);
  }, [activeView, fetchContainers]);

  const dockerAction = async (action, id) => {
    try {
      const res = await fetch(`${API_URL}/api/docker/${action}/${id}`, { method: 'POST', ...fetchOpts });
      const data = await res.json();
      if (data.error) notify(data.error, 'error');
      else { notify(`Container ${action}ed`); setTimeout(fetchContainers, 1000); }
    } catch (e) { notify(`Failed to ${action}`, 'error'); }
  };

  const fetchDockerLogs = async (id, name) => {
    try {
      const res = await fetch(`${API_URL}/api/docker/logs/${id}?tail=200`, fetchOpts);
      const data = await res.json();
      if (data.error) notify(data.error, 'error');
      else setDockerLogs({ name, logs: data.logs });
    } catch (e) { notify('Failed to get logs', 'error'); }
  };

  // File ops
  const openFile = async (file) => {
    if (file.isDir) { fetchFiles(file.path); return; }
    if (file.size > 5 * 1024 * 1024) { notify('File too large (max 5MB)', 'error'); return; }
    setEditorLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(file.path)}`, fetchOpts);
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); setEditorLoading(false); return; }
      setEditorFile(file); setEditorContent(data.content); setEditorDirty(false); setActiveView('editor');
    } catch (e) { notify('Failed to open file', 'error'); }
    setEditorLoading(false);
  };
  const saveFile = async () => {
    if (!editorFile) return;
    try {
      const res = await fetch(`${API_URL}/api/files/write`, {
        method: 'PUT', ...fetchOpts, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editorFile.path, content: editorContent }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      setEditorDirty(false); notify('File saved');
    } catch (e) { notify('Failed to save', 'error'); }
  };
  const createItem = async (name, isDir) => {
    const itemPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      const res = await fetch(`${API_URL}/api/files/create`, {
        method: 'POST', ...fetchOpts, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath, isDir }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify(isDir ? 'Folder created' : 'File created'); fetchFiles(currentPath);
    } catch (e) { notify('Failed to create', 'error'); }
    setModal(null);
  };
  const deleteItem = async (file) => {
    try {
      const res = await fetch(`${API_URL}/api/files/delete`, {
        method: 'DELETE', ...fetchOpts, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify('Deleted'); fetchFiles(currentPath);
    } catch (e) { notify('Failed to delete', 'error'); }
    setContextMenu(null);
  };
  const renameItem = async (file, newName) => {
    const dir = file.path.split('/').slice(0, -1).join('/');
    const newPath = dir ? `${dir}/${newName}` : newName;
    try {
      const res = await fetch(`${API_URL}/api/files/rename`, {
        method: 'PUT', ...fetchOpts, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: file.path, newPath }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify('Renamed'); fetchFiles(currentPath);
    } catch (e) { notify('Failed to rename', 'error'); }
    setModal(null);
  };

  const breadcrumbs = currentPath ? currentPath.split('/') : [];
  const filteredFiles = searchQuery ? files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase())) : files;

  const sortedProcs = [...(processes.processes || [])].sort((a, b) => {
    if (procSort === 'cpu') return b.cpu - a.cpu;
    if (procSort === 'name') return a.name.localeCompare(b.name);
    return b.mem - a.mem;
  });

  const tabs = [
    { id: 'dashboard', label: 'Dashboard', icon: <MonitorSmartphone size={15} /> },
    { id: 'files', label: 'Files', icon: <Folder size={15} /> },
    { id: 'processes', label: 'Processes', icon: <ListTree size={15} /> },
    { id: 'docker', label: 'Docker', icon: <Box size={15} /> },
    { id: 'terminal', label: 'Terminal', icon: <TermIcon size={15} /> },
  ];

  return (
    <div className="min-h-screen bg-[#f0f2f5] text-gray-800 flex flex-col" onClick={() => setContextMenu(null)}>
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-200/60 px-6 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-600 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-violet-200">
            <Server size={17} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-gray-900 leading-tight">Enclave</h1>
            <p className="text-[10px] text-gray-400 font-medium">{stats.hostname || 'Dev Box'}</p>
          </div>
        </div>
        <nav className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => { setActiveView(tab.id); if (tab.id === 'files') fetchFiles(currentPath); }}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${activeView === tab.id || (activeView === 'editor' && tab.id === 'files') ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {tab.icon} <span className="hidden md:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
        <div className="text-right">
          <div className="text-sm font-bold text-gray-900">{now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="text-[10px] text-gray-400">{now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-5">

        {/* ═══ DASHBOARD ═══ */}
        {activeView === 'dashboard' && (
          <div className="max-w-6xl mx-auto grid grid-cols-4 gap-4 auto-rows-min">
            <div className="col-span-2 bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-sm font-bold text-gray-900">System Status</h2>
                <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full font-medium">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div> Online
                </div>
              </div>
              <div className="flex items-center justify-around">
                <CircularGauge value={stats.cpu || 0} max={100} label="CPU" color={stats.cpu > 80 ? 'red' : stats.cpu > 50 ? 'orange' : 'blue'}
                  icon={<Cpu size={11} />} sub={`${stats.cpuCores || 0} cores`} />
                <CircularGauge value={stats.ram || 0} max={stats.ramTotal || 1} label="RAM" color="violet"
                  icon={<Activity size={11} />} sub={`${stats.ram || 0} / ${stats.ramTotal || 0} GB`} />
                <CircularGauge value={stats.storageUsed || 0} max={stats.storageTotal || 1} label="Storage" color="emerald"
                  icon={<HardDrive size={11} />} sub={`${stats.storageUsed || 0} / ${stats.storageTotal || 0} GB`} />
              </div>
            </div>
            <div className="col-span-1 bg-gradient-to-br from-orange-50 to-amber-50 rounded-2xl p-5 shadow-sm border border-orange-100/50">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center"><Thermometer size={16} className="text-orange-500" /></div>
                <span className="text-xs font-bold text-gray-700">Temperature</span>
              </div>
              <div className="text-3xl font-bold text-orange-600 mb-1">{stats.cpuTemp ? `${stats.cpuTemp}°C` : 'N/A'}</div>
              <div className="text-[11px] text-gray-500">{stats.cpuTemp ? (stats.cpuTemp > 70 ? 'Running hot' : stats.cpuTemp > 50 ? 'Warm' : 'Cool') : 'Sensor unavailable'}</div>
              {stats.cpuTempMax && <div className="text-[10px] text-gray-400 mt-1">Max: {stats.cpuTempMax}°C</div>}
            </div>
            <div className="col-span-1 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl p-5 shadow-sm border border-blue-100/50">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center"><Clock size={16} className="text-blue-500" /></div>
                <span className="text-xs font-bold text-gray-700">Uptime</span>
              </div>
              <div className="text-2xl font-bold text-blue-600 mb-1">{formatUptime(stats.uptime || 0)}</div>
              <div className="text-[11px] text-gray-500">{stats.platform || ''}</div>
            </div>
            <div className="col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-cyan-50 rounded-lg flex items-center justify-center"><Wifi size={16} className="text-cyan-500" /></div>
                <span className="text-xs font-bold text-gray-700">Network</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2"><ArrowDownLeft size={14} className="text-emerald-500" /><span className="text-[11px] font-medium text-gray-500">Download</span></div>
                  <div className="text-xl font-bold text-gray-900">{stats.netDown || 0} <span className="text-xs font-normal text-gray-400">KB/s</span></div>
                </div>
                <div className="bg-gray-50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2"><ArrowUpRight size={14} className="text-blue-500" /><span className="text-[11px] font-medium text-gray-500">Upload</span></div>
                  <div className="text-xl font-bold text-gray-900">{stats.netUp || 0} <span className="text-xs font-normal text-gray-400">KB/s</span></div>
                </div>
              </div>
            </div>
            <div className="col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="text-xs font-bold text-gray-700 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-4 gap-3">
                <button onClick={() => { setActiveView('files'); fetchFiles(''); }}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-50 hover:bg-blue-100 transition group">
                  <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center shadow-md shadow-blue-200 group-hover:scale-105 transition">
                    <Folder size={18} className="text-white" />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700">Files</span>
                </button>
                <button onClick={() => setActiveView('terminal')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-violet-50 hover:bg-violet-100 transition group">
                  <div className="w-10 h-10 bg-violet-500 rounded-xl flex items-center justify-center shadow-md shadow-violet-200 group-hover:scale-105 transition">
                    <TermIcon size={18} className="text-white" />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700">Terminal</span>
                </button>
                <button onClick={() => setActiveView('processes')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-50 hover:bg-orange-100 transition group">
                  <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-md shadow-orange-200 group-hover:scale-105 transition">
                    <ListTree size={18} className="text-white" />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700">Processes</span>
                </button>
                <button onClick={() => setActiveView('docker')}
                  className="flex flex-col items-center gap-2 p-4 rounded-xl bg-cyan-50 hover:bg-cyan-100 transition group">
                  <div className="w-10 h-10 bg-cyan-500 rounded-xl flex items-center justify-center shadow-md shadow-cyan-200 group-hover:scale-105 transition">
                    <Box size={18} className="text-white" />
                  </div>
                  <span className="text-[11px] font-medium text-gray-700">Docker</span>
                </button>
              </div>
            </div>
            <div className="col-span-4 bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <h3 className="text-xs font-bold text-gray-700 mb-3">System Info</h3>
              <div className="grid grid-cols-4 gap-4 text-xs">
                <InfoItem label="Hostname" value={stats.hostname || '—'} />
                <InfoItem label="CPU" value={stats.cpuModel || '—'} />
                <InfoItem label="Platform" value={stats.platform || '—'} />
                <InfoItem label="Cores" value={`${stats.cpuCores || '—'} vCPU`} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ PROCESSES ═══ */}
        {activeView === 'processes' && (
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-gray-900">Processes</h2>
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{processes.total} total / {processes.running} running</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-gray-500">Sort by:</span>
                {['mem', 'cpu', 'name'].map(s => (
                  <button key={s} onClick={() => setProcSort(s)}
                    className={`px-2.5 py-1 text-[11px] rounded-lg font-medium transition ${procSort === s ? 'bg-violet-100 text-violet-700' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                    {s.toUpperCase()}
                  </button>
                ))}
                <button onClick={fetchProcesses} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><RefreshCw size={14} /></button>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="grid grid-cols-[60px_1fr_1fr_80px_80px_80px_50px] gap-2 px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-50">
                <span>PID</span><span>Name</span><span>Command</span><span>CPU %</span><span>Memory</span><span>User</span><span></span>
              </div>
              {sortedProcs.map(p => (
                <div key={p.pid} className="grid grid-cols-[60px_1fr_1fr_80px_80px_80px_50px] gap-2 px-5 py-2.5 items-center hover:bg-violet-50/30 border-b border-gray-50/80 transition text-xs group">
                  <span className="text-gray-400 font-mono">{p.pid}</span>
                  <span className="font-medium text-gray-700 truncate">{p.name}</span>
                  <span className="text-gray-400 truncate font-mono text-[11px]">{p.command}</span>
                  <span className={`font-medium ${p.cpu > 50 ? 'text-red-500' : p.cpu > 10 ? 'text-orange-500' : 'text-gray-600'}`}>{p.cpu}%</span>
                  <span className="text-gray-600">{p.mem} MB</span>
                  <span className="text-gray-400">{p.user}</span>
                  <button onClick={() => killProcess(p.pid)}
                    className="p-1 rounded-lg hover:bg-red-50 opacity-0 group-hover:opacity-100 transition" title="Kill process">
                    <XCircle size={14} className="text-red-400 hover:text-red-600" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ═══ DOCKER ═══ */}
        {activeView === 'docker' && (
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-gray-900">Docker Containers</h2>
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{containers.length} containers</span>
              </div>
              <button onClick={fetchContainers} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><RefreshCw size={14} /></button>
            </div>
            <div className="grid gap-3">
              {containers.map(c => (
                <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${c.state === 'running' ? 'bg-emerald-50' : c.state === 'paused' ? 'bg-yellow-50' : 'bg-gray-100'}`}>
                        <Box size={18} className={c.state === 'running' ? 'text-emerald-500' : c.state === 'paused' ? 'text-yellow-500' : 'text-gray-400'} />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                        <div className="text-[11px] text-gray-400">{c.image}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${c.state === 'running' ? 'bg-emerald-50 text-emerald-600' : c.state === 'paused' ? 'bg-yellow-50 text-yellow-600' : 'bg-gray-100 text-gray-500'}`}>
                          {c.state}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-1">{c.status}</div>
                      </div>
                      <div className="flex items-center gap-1">
                        {c.state === 'running' && (
                          <>
                            <button onClick={() => dockerAction('stop', c.id)} className="p-2 rounded-lg hover:bg-red-50 transition" title="Stop">
                              <Square size={14} className="text-red-400" />
                            </button>
                            <button onClick={() => dockerAction('restart', c.id)} className="p-2 rounded-lg hover:bg-blue-50 transition" title="Restart">
                              <RotateCw size={14} className="text-blue-400" />
                            </button>
                            <button onClick={() => dockerAction('pause', c.id)} className="p-2 rounded-lg hover:bg-yellow-50 transition" title="Pause">
                              <Pause size={14} className="text-yellow-500" />
                            </button>
                          </>
                        )}
                        {c.state === 'paused' && (
                          <button onClick={() => dockerAction('unpause', c.id)} className="p-2 rounded-lg hover:bg-emerald-50 transition" title="Unpause">
                            <Play size={14} className="text-emerald-500" />
                          </button>
                        )}
                        {(c.state === 'exited' || c.state === 'created') && (
                          <button onClick={() => dockerAction('start', c.id)} className="p-2 rounded-lg hover:bg-emerald-50 transition" title="Start">
                            <Play size={14} className="text-emerald-500" />
                          </button>
                        )}
                        <button onClick={() => fetchDockerLogs(c.id, c.name)} className="p-2 rounded-lg hover:bg-gray-100 transition" title="Logs">
                          <ScrollText size={14} className="text-gray-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                  {c.ports.length > 0 && (
                    <div className="mt-3 flex gap-2">
                      {c.ports.map((p, i) => (
                        <span key={i} className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded-md font-mono">{p}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {containers.length === 0 && (
                <div className="bg-white rounded-2xl p-12 text-center shadow-sm border border-gray-100">
                  <Box size={40} className="mx-auto text-gray-200 mb-3" />
                  <div className="text-sm text-gray-400">No containers found</div>
                  <div className="text-[11px] text-gray-300 mt-1">Docker may not be accessible</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ FILES ═══ */}
        {activeView === 'files' && (
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button onClick={() => { const p = currentPath.split('/').slice(0, -1).join('/'); fetchFiles(p); }}
                  className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><ArrowLeft size={16} /></button>
                <button onClick={() => fetchFiles('')}
                  className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><Home size={16} /></button>
                <div className="flex items-center text-sm text-gray-500 ml-2 bg-white rounded-xl px-3 py-1.5 shadow-sm border border-gray-100">
                  <button onClick={() => fetchFiles('')} className="hover:text-violet-600 transition font-medium">/</button>
                  {breadcrumbs.map((crumb, i) => (
                    <React.Fragment key={i}>
                      <ChevronRight size={13} className="mx-1 text-gray-300" />
                      <button onClick={() => fetchFiles(breadcrumbs.slice(0, i + 1).join('/'))} className="hover:text-violet-600 transition">{crumb}</button>
                    </React.Fragment>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-white rounded-xl border border-gray-100 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-100 w-44 transition shadow-sm" />
                </div>
                <label className="flex items-center gap-1.5 text-[11px] text-gray-500 bg-white px-3 py-1.5 rounded-xl shadow-sm border border-gray-100 cursor-pointer select-none">
                  <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="accent-violet-500 w-3 h-3" /> Hidden
                </label>
                <button onClick={() => fetchFiles(currentPath)} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><RefreshCw size={14} /></button>
                <button onClick={() => setModal({ type: 'newFile' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-500 text-white rounded-xl hover:bg-violet-600 transition shadow-sm shadow-violet-200 font-medium"><FilePlus size={14} /> File</button>
                <button onClick={() => setModal({ type: 'newFolder' })}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-500 text-white rounded-xl hover:bg-blue-600 transition shadow-sm shadow-blue-200 font-medium"><FolderPlus size={14} /> Folder</button>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="grid grid-cols-[1fr_90px_150px_36px] gap-3 px-5 py-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-50">
                <span>Name</span><span>Size</span><span>Modified</span><span></span>
              </div>
              {filteredFiles.length === 0 && (
                <div className="py-20 text-center"><Folder size={40} className="mx-auto text-gray-200 mb-3" /><div className="text-sm text-gray-400">{searchQuery ? 'No matching files' : 'Empty folder'}</div></div>
              )}
              {filteredFiles.map(f => (
                <div key={f.path} className="grid grid-cols-[1fr_90px_150px_36px] gap-3 px-5 py-3 items-center hover:bg-violet-50/40 border-b border-gray-50/80 cursor-pointer transition group"
                  onClick={() => openFile(f)} onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, file: f }); }}>
                  <div className="flex items-center gap-3 min-w-0">{getFileIcon(f.name, f.isDir)}<span className="text-sm truncate font-medium text-gray-700">{f.name}</span></div>
                  <span className="text-[11px] text-gray-400">{f.isDir ? '—' : formatSize(f.size)}</span>
                  <span className="text-[11px] text-gray-400">{formatDate(f.modified)}</span>
                  <button onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file: f }); }}
                    className="p-1 rounded-lg hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition"><MoreVertical size={13} className="text-gray-400" /></button>
                </div>
              ))}
            </div>
            <div className="mt-2.5 text-[11px] text-gray-400 text-right">{files.length} items</div>
          </div>
        )}

        {/* ═══ EDITOR ═══ */}
        {activeView === 'editor' && editorFile && (
          <div className="max-w-6xl mx-auto flex flex-col h-[calc(100vh-120px)]">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveView('files')} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><ArrowLeft size={16} /></button>
                <div className="bg-white rounded-xl px-4 py-2 shadow-sm border border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">{getFileIcon(editorFile.name, false)} {editorFile.name} {editorDirty && <span className="w-2 h-2 bg-orange-400 rounded-full"></span>}</h2>
                  <p className="text-[10px] text-gray-400">/{editorFile.path}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveFile} className={`flex items-center gap-1.5 px-4 py-2 text-xs rounded-xl transition font-medium shadow-sm ${editorDirty ? 'bg-violet-500 text-white hover:bg-violet-600 shadow-violet-200' : 'bg-gray-100 text-gray-400 cursor-default'}`} disabled={!editorDirty}><Save size={14} /> Save</button>
                <button onClick={() => { setEditorFile(null); setActiveView('files'); }} className="p-2 rounded-xl hover:bg-white text-gray-400 hover:text-gray-600 transition shadow-sm bg-white/60"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
              <div className="h-full flex">
                <div className="w-12 bg-gray-50 border-r border-gray-100 pt-4 text-right pr-3 select-none overflow-hidden">
                  {editorContent.split('\n').map((_, i) => (<div key={i} className="text-[11px] text-gray-300 leading-[1.65rem] font-mono">{i + 1}</div>))}
                </div>
                <textarea value={editorContent} onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                  className="flex-1 p-4 font-mono text-sm text-gray-800 bg-white resize-none focus:outline-none leading-relaxed" spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveFile(); }
                    if (e.key === 'Tab') { e.preventDefault(); const s = e.target.selectionStart, end = e.target.selectionEnd; setEditorContent(editorContent.substring(0, s) + '  ' + editorContent.substring(end)); setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = s + 2; }, 0); }
                  }} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ TERMINAL (always mounted, hidden via CSS to preserve state) ═══ */}
        <div className={`max-w-6xl mx-auto h-[calc(100vh-120px)] ${activeView === 'terminal' ? '' : 'hidden'}`}>
          <div className="bg-[#0f1117] rounded-2xl overflow-hidden shadow-lg border border-gray-800/30 h-full">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0a0b10] border-b border-white/5">
              <div className="w-3 h-3 rounded-full bg-[#ff5f57]"></div>
              <div className="w-3 h-3 rounded-full bg-[#febc2e]"></div>
              <div className="w-3 h-3 rounded-full bg-[#28c840]"></div>
              <span className="ml-3 text-[11px] text-gray-500 font-mono">{stats.hostname || 'dev-box'} — bash</span>
            </div>
            <div id="terminal-box" className="h-[calc(100%-40px)] p-1"></div>
          </div>
        </div>
      </main>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 min-w-[170px] animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }} onClick={e => e.stopPropagation()}>
          {!contextMenu.file.isDir && <CtxItem icon={<Eye size={14} />} label="Open" onClick={() => { openFile(contextMenu.file); setContextMenu(null); }} />}
          {contextMenu.file.isDir && <CtxItem icon={<Folder size={14} />} label="Open folder" onClick={() => { fetchFiles(contextMenu.file.path); setContextMenu(null); }} />}
          <CtxItem icon={<Edit3 size={14} />} label="Rename" onClick={() => { setModal({ type: 'rename', file: contextMenu.file }); setContextMenu(null); }} />
          <div className="border-t border-gray-100 my-1"></div>
          <CtxItem icon={<Trash2 size={14} />} label="Delete" danger onClick={() => deleteItem(contextMenu.file)} />
        </div>
      )}

      {modal && <Modal modal={modal} setModal={setModal} createItem={createItem} renameItem={renameItem} />}

      {/* Docker Logs Modal */}
      {dockerLogs && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setDockerLogs(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col border border-gray-100 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <ScrollText size={16} className="text-gray-400" />
                <span className="text-sm font-bold text-gray-900">{dockerLogs.name} — Logs</span>
              </div>
              <button onClick={() => setDockerLogs(null)} className="p-1.5 rounded-lg hover:bg-gray-100 transition"><X size={16} className="text-gray-400" /></button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-[11px] font-mono text-gray-700 bg-gray-50 whitespace-pre-wrap leading-relaxed">{dockerLogs.logs || 'No logs'}</pre>
          </div>
        </div>
      )}

      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium animate-slide-up ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-900 text-white'}`}>
          {notification.msg}
        </div>
      )}
      {editorLoading && (
        <div className="fixed inset-0 bg-black/10 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white px-6 py-4 rounded-2xl shadow-xl text-sm text-gray-600">Loading...</div>
        </div>
      )}
    </div>
  );
}

function InfoItem({ label, value }) {
  return (<div className="bg-gray-50 rounded-xl p-3"><div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</div><div className="text-xs font-semibold text-gray-700 truncate">{value}</div></div>);
}
function CtxItem({ icon, label, onClick, danger }) {
  return (<button onClick={onClick} className={`flex items-center gap-2.5 px-3.5 py-2 text-xs w-full text-left hover:bg-gray-50 transition font-medium ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-600'}`}>{icon} {label}</button>);
}
function Modal({ modal, setModal, createItem, renameItem }) {
  const [name, setName] = useState(modal.file?.name || '');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const handleSubmit = (e) => { e.preventDefault(); if (!name.trim()) return; if (modal.type === 'newFile') createItem(name.trim(), false); else if (modal.type === 'newFolder') createItem(name.trim(), true); else if (modal.type === 'rename') renameItem(modal.file, name.trim()); };
  const titles = { newFile: 'New File', newFolder: 'New Folder', rename: 'Rename' };
  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setModal(null)}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm border border-gray-100 animate-scale-in">
        <h3 className="text-sm font-bold text-gray-900 mb-4">{titles[modal.type]}</h3>
        <input ref={inputRef} value={name} onChange={e => setName(e.target.value)} placeholder="Enter name..." autoFocus
          className="w-full px-3.5 py-2.5 text-sm border border-gray-200 rounded-xl focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 mb-4 transition" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setModal(null)} className="px-4 py-2 text-xs text-gray-500 hover:bg-gray-50 rounded-xl transition font-medium">Cancel</button>
          <button type="submit" className="px-5 py-2 text-xs bg-violet-500 text-white rounded-xl hover:bg-violet-600 transition font-medium shadow-sm shadow-violet-200">{modal.type === 'rename' ? 'Rename' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}
