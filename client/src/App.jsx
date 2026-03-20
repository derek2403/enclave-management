import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import { Terminal as TermIcon, Folder, FileText, ChevronLeft, Cpu, Activity, HardDrive } from 'lucide-react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

const API_URL = `https://${import.meta.env.VITE_API_DOMAIN}`;
const socket = io(API_URL);

export default function App() {
  const [stats, setStats] = useState({ cpu: 0, ram: 0, storage: 0 });
  const [currentPath, setCurrentPath] = useState('');
  const [files, setFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('explorer'); // 'explorer' or 'terminal'
  const termRef = useRef(null);

  useEffect(() => {
    socket.on('stats', (data) => setStats(data));
    fetchFiles('');
    
    // Initialize Terminal
    const term = new Terminal({ cursorBlink: true, theme: { background: '#09090b', foreground: '#22c55e' }, fontSize: 12 });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-box'));
    fitAddon.fit();

    socket.on('terminal_output', data => term.write(data));
    term.onData(data => socket.emit('terminal_input', data));

    return () => { socket.off('terminal_output'); term.dispose(); };
  }, []);

  const fetchFiles = async (path) => {
    const res = await fetch(`${API_URL}/api/files/list?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setFiles(data.sort((a, b) => b.isDir - a.isDir));
    setCurrentPath(path);
  };

  return (
    <div className="min-h-screen bg-black text-green-500 p-4 font-mono">
      <header className="border-b border-green-900 pb-4 mb-4 flex justify-between items-center">
        <h1 className="text-lg font-black tracking-widest text-white uppercase">Enclave_OS_v1.1</h1>
        <div className="flex gap-4 text-[10px]">
          <div className="border border-green-900 px-2 py-1 flex items-center gap-2"><Cpu size={12}/> {stats.cpu}%</div>
          <div className="border border-green-900 px-2 py-1 flex items-center gap-2"><Activity size={12}/> {stats.ram}GB</div>
          <div className="border border-green-900 px-2 py-1 flex items-center gap-2"><HardDrive size={12}/> {stats.storage}%</div>
        </div>
      </header>

      {/* TAB SELECTOR */}
      <div className="flex gap-2 mb-4">
        <TabBtn active={activeTab === 'explorer'} onClick={() => setActiveTab('explorer')} label="EXPLORER" icon={<Folder size={14}/>} />
        <TabBtn active={activeTab === 'terminal'} onClick={() => setActiveTab('terminal')} label="TERMINAL" icon={<TermIcon size={14}/>} />
      </div>

      <div className="grid grid-cols-1 h-[75vh]">
        {/* EXPLORER VIEW */}
        <div className={`${activeTab === 'explorer' ? 'block' : 'hidden'} bg-zinc-950 border border-green-900 rounded p-4 overflow-auto`}>
          <div className="flex items-center gap-2 mb-4 text-[10px] text-green-800 border-b border-green-900 pb-2">
            <button onClick={() => fetchFiles(currentPath.split('/').slice(0, -1).join('/'))}><ChevronLeft size={16}/></button>
            <span>/{currentPath}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
            {files.map(f => (
              <div key={f.path} onClick={() => f.isDir && fetchFiles(f.path)} className="flex flex-col items-center p-2 cursor-pointer hover:bg-green-500/10 rounded transition-all">
                {f.isDir ? <Folder className="text-blue-500" /> : <FileText className="text-zinc-600" />}
                <span className="text-[10px] mt-2 truncate w-full text-center">{f.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* TERMINAL VIEW */}
        <div className={`${activeTab === 'terminal' ? 'block' : 'hidden'} bg-zinc-950 border border-green-900 rounded p-2 overflow-hidden`}>
          <div id="terminal-box" className="h-full w-full"></div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, label, icon }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 px-4 py-1 text-[10px] border ${active ? 'bg-green-900 text-white border-green-400' : 'border-green-900 text-green-800'}`}>
      {icon} {label}
    </button>
  );
}