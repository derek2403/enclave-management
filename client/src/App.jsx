import React, { useEffect, useState, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import {
  Terminal as TermIcon, Folder, FileText, ChevronRight, Cpu, Activity,
  HardDrive, Home, ArrowLeft, Trash2, Edit3, Save, X, FolderPlus,
  FilePlus, RefreshCw, MoreVertical, Eye, Search, Server
} from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const API_URL = `https://${import.meta.env.VITE_API_DOMAIN}`;
const socket = io(API_URL, { withCredentials: true });

const fetchOpts = { credentials: 'include' };

function formatSize(bytes) {
  if (bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getFileIcon(name, isDir) {
  if (isDir) return <Folder size={20} className="text-blue-500" />;
  const ext = name.split('.').pop().toLowerCase();
  const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yml', 'yaml', 'toml', 'xml', 'sh', 'bash', 'md', 'txt', 'env', 'conf', 'cfg', 'ini', 'sql', 'vue', 'svelte'];
  if (codeExts.includes(ext)) return <FileText size={20} className="text-violet-500" />;
  return <FileText size={20} className="text-gray-400" />;
}

export default function App() {
  const [stats, setStats] = useState({ cpu: 0, ram: 0, ramTotal: 0, storage: 0, storageUsed: 0, storageTotal: 0 });
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [activeView, setActiveView] = useState('files');
  const [editorFile, setEditorFile] = useState(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [notification, setNotification] = useState(null);
  const termRef = useRef(null);
  const termInitRef = useRef(false);
  const editorRef = useRef(null);

  const notify = useCallback((msg, type = 'success') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3000);
  }, []);

  const fetchFiles = useCallback(async (p) => {
    try {
      const res = await fetch(`${API_URL}/api/files/list?path=${encodeURIComponent(p)}`, fetchOpts);
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      setFiles(data.sort((a, b) => b.isDir - a.isDir || a.name.localeCompare(b.name)));
      setCurrentPath(p);
    } catch (e) { notify('Failed to load files', 'error'); }
  }, [notify]);

  useEffect(() => {
    socket.on('stats', setStats);
    fetchFiles('');
    return () => { socket.off('stats'); };
  }, [fetchFiles]);

  useEffect(() => {
    if (activeView !== 'terminal' || termInitRef.current) return;
    termInitRef.current = true;
    const term = new Terminal({
      cursorBlink: true,
      theme: { background: '#1a1b2e', foreground: '#e2e8f0', cursor: '#7c3aed' },
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      lineHeight: 1.4,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    const el = document.getElementById('terminal-box');
    if (el) {
      term.open(el);
      fitAddon.fit();
      const ro = new ResizeObserver(() => fitAddon.fit());
      ro.observe(el);
    }
    socket.on('terminal_output', data => term.write(data));
    term.onData(data => socket.emit('terminal_input', data));
    termRef.current = term;
    return () => { socket.off('terminal_output'); };
  }, [activeView]);

  const openFile = async (file) => {
    if (file.isDir) { fetchFiles(file.path); return; }
    if (file.size > 5 * 1024 * 1024) { notify('File too large to open (max 5MB)', 'error'); return; }
    setEditorLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/files/read?path=${encodeURIComponent(file.path)}`, fetchOpts);
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); setEditorLoading(false); return; }
      setEditorFile(file);
      setEditorContent(data.content);
      setEditorDirty(false);
      setActiveView('editor');
    } catch (e) { notify('Failed to open file', 'error'); }
    setEditorLoading(false);
  };

  const saveFile = async () => {
    if (!editorFile) return;
    try {
      const res = await fetch(`${API_URL}/api/files/write`, {
        method: 'PUT', ...fetchOpts,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editorFile.path, content: editorContent }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      setEditorDirty(false);
      notify('File saved');
    } catch (e) { notify('Failed to save file', 'error'); }
  };

  const createItem = async (name, isDir) => {
    const itemPath = currentPath ? `${currentPath}/${name}` : name;
    try {
      const res = await fetch(`${API_URL}/api/files/create`, {
        method: 'POST', ...fetchOpts,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: itemPath, isDir }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify(isDir ? 'Folder created' : 'File created');
      fetchFiles(currentPath);
    } catch (e) { notify('Failed to create', 'error'); }
    setModal(null);
  };

  const deleteItem = async (file) => {
    try {
      const res = await fetch(`${API_URL}/api/files/delete`, {
        method: 'DELETE', ...fetchOpts,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: file.path }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify('Deleted');
      fetchFiles(currentPath);
    } catch (e) { notify('Failed to delete', 'error'); }
    setContextMenu(null);
  };

  const renameItem = async (file, newName) => {
    const dir = file.path.split('/').slice(0, -1).join('/');
    const newPath = dir ? `${dir}/${newName}` : newName;
    try {
      const res = await fetch(`${API_URL}/api/files/rename`, {
        method: 'PUT', ...fetchOpts,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: file.path, newPath }),
      });
      const data = await res.json();
      if (data.error) { notify(data.error, 'error'); return; }
      notify('Renamed');
      fetchFiles(currentPath);
    } catch (e) { notify('Failed to rename', 'error'); }
    setModal(null);
  };

  const breadcrumbs = currentPath ? currentPath.split('/') : [];
  const filteredFiles = searchQuery
    ? files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : files;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-800 flex flex-col" onClick={() => setContextMenu(null)}>
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-blue-500 rounded-xl flex items-center justify-center">
            <Server size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-gray-900 leading-tight">Enclave</h1>
            <p className="text-[11px] text-gray-400">Dev Box Management</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatPill icon={<Cpu size={14} />} label="CPU" value={`${stats.cpu}%`} color="blue" />
          <StatPill icon={<Activity size={14} />} label="RAM" value={`${stats.ram}GB`} sub={`/ ${stats.ramTotal}GB`} color="violet" />
          <StatPill icon={<HardDrive size={14} />} label="Disk" value={`${stats.storageUsed}GB`} sub={`/ ${stats.storageTotal}GB`} color="emerald" />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 bg-white border-r border-gray-200 p-3 flex flex-col gap-1 shrink-0">
          <SidebarBtn active={activeView === 'files'} onClick={() => setActiveView('files')} icon={<Folder size={18} />} label="Files" />
          <SidebarBtn active={activeView === 'terminal'} onClick={() => setActiveView('terminal')} icon={<TermIcon size={18} />} label="Terminal" />
          {editorFile && (
            <SidebarBtn active={activeView === 'editor'} onClick={() => setActiveView('editor')} icon={<Edit3 size={18} />} label={editorFile.name} badge={editorDirty ? 'M' : null} />
          )}
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-5">
          {/* Files View */}
          {activeView === 'files' && (
            <div className="max-w-6xl mx-auto">
              {/* Toolbar */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button onClick={() => fetchFiles(currentPath.split('/').slice(0, -1).join('/'))}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Go back">
                    <ArrowLeft size={18} />
                  </button>
                  <button onClick={() => fetchFiles('')}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Go home">
                    <Home size={18} />
                  </button>
                  <div className="flex items-center text-sm text-gray-500 ml-2">
                    <button onClick={() => fetchFiles('')} className="hover:text-violet-600 transition">/</button>
                    {breadcrumbs.map((crumb, i) => (
                      <React.Fragment key={i}>
                        <ChevronRight size={14} className="mx-1 text-gray-300" />
                        <button
                          onClick={() => fetchFiles(breadcrumbs.slice(0, i + 1).join('/'))}
                          className="hover:text-violet-600 transition"
                        >{crumb}</button>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text" placeholder="Search files..."
                      value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-sm bg-gray-100 rounded-lg border border-transparent focus:border-violet-300 focus:bg-white focus:outline-none w-48 transition"
                    />
                  </div>
                  <button onClick={() => fetchFiles(currentPath)}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition" title="Refresh">
                    <RefreshCw size={16} />
                  </button>
                  <button onClick={() => setModal({ type: 'newFile' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition">
                    <FilePlus size={15} /> New File
                  </button>
                  <button onClick={() => setModal({ type: 'newFolder' })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition">
                    <FolderPlus size={15} /> New Folder
                  </button>
                </div>
              </div>

              {/* File list */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="grid grid-cols-[1fr_100px_160px_40px] gap-4 px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wider border-b border-gray-100">
                  <span>Name</span>
                  <span>Size</span>
                  <span>Modified</span>
                  <span></span>
                </div>
                {filteredFiles.length === 0 && (
                  <div className="py-16 text-center text-gray-400 text-sm">
                    {searchQuery ? 'No matching files' : 'This folder is empty'}
                  </div>
                )}
                {filteredFiles.map(f => (
                  <div key={f.path}
                    className="grid grid-cols-[1fr_100px_160px_40px] gap-4 px-4 py-2.5 items-center hover:bg-gray-50 border-b border-gray-50 cursor-pointer transition group"
                    onClick={() => openFile(f)}
                    onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, file: f }); }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getFileIcon(f.name, f.isDir)}
                      <span className="text-sm truncate">{f.name}</span>
                    </div>
                    <span className="text-xs text-gray-400">{f.isDir ? '—' : formatSize(f.size)}</span>
                    <span className="text-xs text-gray-400">{formatDate(f.modified)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, file: f }); }}
                      className="p-1 rounded hover:bg-gray-200 opacity-0 group-hover:opacity-100 transition"
                    >
                      <MoreVertical size={14} className="text-gray-400" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-400 text-right">{files.length} items</div>
            </div>
          )}

          {/* Editor View */}
          {activeView === 'editor' && editorFile && (
            <div className="max-w-6xl mx-auto flex flex-col h-[calc(100vh-130px)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <button onClick={() => setActiveView('files')}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
                    <ArrowLeft size={18} />
                  </button>
                  <div>
                    <h2 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                      {editorFile.name}
                      {editorDirty && <span className="w-2 h-2 bg-orange-400 rounded-full"></span>}
                    </h2>
                    <p className="text-[11px] text-gray-400">/{editorFile.path}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={saveFile}
                    className={`flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg transition ${editorDirty ? 'bg-violet-600 text-white hover:bg-violet-700' : 'bg-gray-100 text-gray-400 cursor-default'}`}
                    disabled={!editorDirty}>
                    <Save size={15} /> Save
                  </button>
                  <button onClick={() => { setEditorFile(null); setActiveView('files'); }}
                    className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 transition">
                    <X size={18} />
                  </button>
                </div>
              </div>
              <div className="flex-1 bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <textarea
                  ref={editorRef}
                  value={editorContent}
                  onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                  className="w-full h-full p-4 font-mono text-sm text-gray-800 bg-white resize-none focus:outline-none leading-relaxed"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveFile(); }
                    if (e.key === 'Tab') {
                      e.preventDefault();
                      const start = e.target.selectionStart;
                      const end = e.target.selectionEnd;
                      setEditorContent(editorContent.substring(0, start) + '  ' + editorContent.substring(end));
                      setTimeout(() => { e.target.selectionStart = e.target.selectionEnd = start + 2; }, 0);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {/* Terminal View */}
          {activeView === 'terminal' && (
            <div className="max-w-6xl mx-auto h-[calc(100vh-130px)]">
              <div className="bg-[#1a1b2e] rounded-xl overflow-hidden shadow-sm border border-gray-200 h-full">
                <div className="flex items-center gap-2 px-4 py-2.5 bg-[#151627] border-b border-gray-700/30">
                  <div className="w-3 h-3 rounded-full bg-red-400"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                  <div className="w-3 h-3 rounded-full bg-green-400"></div>
                  <span className="ml-2 text-xs text-gray-400 font-mono">bash — dev-box</span>
                </div>
                <div id="terminal-box" className="h-[calc(100%-40px)] p-2"></div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div className="fixed z-50 bg-white rounded-xl shadow-lg border border-gray-200 py-1 min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}>
          {!contextMenu.file.isDir && (
            <CtxItem icon={<Eye size={15} />} label="Open" onClick={() => { openFile(contextMenu.file); setContextMenu(null); }} />
          )}
          <CtxItem icon={<Edit3 size={15} />} label="Rename" onClick={() => { setModal({ type: 'rename', file: contextMenu.file }); setContextMenu(null); }} />
          <CtxItem icon={<Trash2 size={15} />} label="Delete" danger onClick={() => deleteItem(contextMenu.file)} />
        </div>
      )}

      {/* Modal */}
      {modal && <Modal modal={modal} setModal={setModal} createItem={createItem} renameItem={renameItem} />}

      {/* Notification */}
      {notification && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium ${notification.type === 'error' ? 'bg-red-500 text-white' : 'bg-gray-800 text-white'} animate-slide-up`}>
          {notification.msg}
        </div>
      )}

      {editorLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white px-6 py-4 rounded-xl shadow-lg text-sm text-gray-600">Loading file...</div>
        </div>
      )}
    </div>
  );
}

function StatPill({ icon, value, sub, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    violet: 'bg-violet-50 text-violet-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${colors[color]}`}>
      {icon}
      <span className="text-xs font-medium">{value}</span>
      {sub && <span className="text-[10px] opacity-60">{sub}</span>}
    </div>
  );
}

function SidebarBtn({ active, onClick, icon, label, badge }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm w-full text-left transition ${active ? 'bg-violet-50 text-violet-700 font-medium' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}>
      {icon}
      <span className="truncate flex-1">{label}</span>
      {badge && <span className="w-5 h-5 rounded-full bg-orange-400 text-white text-[10px] flex items-center justify-center font-bold">{badge}</span>}
    </button>
  );
}

function CtxItem({ icon, label, onClick, danger }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2.5 px-3 py-2 text-sm w-full text-left hover:bg-gray-50 transition ${danger ? 'text-red-500 hover:bg-red-50' : 'text-gray-700'}`}>
      {icon} {label}
    </button>
  );
}

function Modal({ modal, setModal, createItem, renameItem }) {
  const [name, setName] = useState(modal.file?.name || '');
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (modal.type === 'newFile') createItem(name.trim(), false);
    else if (modal.type === 'newFolder') createItem(name.trim(), true);
    else if (modal.type === 'rename') renameItem(modal.file, name.trim());
  };

  const titles = { newFile: 'New File', newFolder: 'New Folder', rename: 'Rename' };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setModal(null)}>
      <form onSubmit={handleSubmit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
        <h3 className="text-base font-semibold text-gray-900 mb-4">{titles[modal.type]}</h3>
        <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
          placeholder="Enter name..." autoFocus
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 mb-4" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setModal(null)}
            className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg transition">Cancel</button>
          <button type="submit"
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition">
            {modal.type === 'rename' ? 'Rename' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
