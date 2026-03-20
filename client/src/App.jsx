import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';
import { Folder, FileText, ChevronLeft, Cpu, Activity, HardDrive, Terminal } from 'lucide-react';

const socket = io('https://dash-api.derek2403.win');
const API_BASE = 'https://dash-api.derek2403.win/api';

export default function App() {
  const [stats, setStats] = useState({ cpu: 0, ram: 0, storage: 0 });
  const [currentPath, setCurrentPath] = useState('/');
  const [files, setFiles] = useState([]);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    socket.on('stats', (data) => setStats(data));
    fetchFiles('/');
  }, []);

  const fetchFiles = async (path) => {
    const res = await fetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    setFiles(data.sort((a, b) => b.isDir - a.isDir));
    setCurrentPath(path);
  };

  const handleFileClick = async (file) => {
    if (file.isDir) return fetchFiles(file.path);
    const res = await fetch(`${API_BASE}/files/read?path=${encodeURIComponent(file.path)}`);
    const data = await res.json();
    setPreview({ name: file.name, content: data.content });
  };

  return (
    <div className="min-h-screen bg-black text-green-400 p-6 font-mono">
      <header className="border-b border-green-900 pb-4 mb-6 flex justify-between items-center">
        <h1 className="text-xl font-black tracking-tighter italic">ENCLAVE_OS // v1.0</h1>
        <div className="flex gap-6 text-[10px]">
          <div className="flex items-center gap-2"><Cpu size={14}/> {stats.cpu}%</div>
          <div className="flex items-center gap-2"><Activity size={14}/> {stats.ram}GB</div>
          <div className="flex items-center gap-2"><HardDrive size={14}/> {stats.storage}%</div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* FILE EXPLORER */}
        <div className="lg:col-span-3 bg-zinc-950 border border-green-900 rounded-lg p-4 h-[600px] overflow-auto">
          <div className="flex items-center gap-2 mb-4 border-b border-green-900 pb-2">
            <button onClick={() => fetchFiles(currentPath.split('/').slice(0, -1).join('/') || '/')} className="hover:text-white"><ChevronLeft size={20}/></button>
            <span className="text-xs text-green-800 uppercase tracking-widest">{currentPath}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {files.map(f => (
              <div key={f.path} onClick={() => handleFileClick(f)} className="group flex flex-col items-center p-2 cursor-pointer hover:bg-green-500/10 rounded border border-transparent hover:border-green-800 transition-all">
                {f.isDir ? <Folder className="text-blue-500 group-hover:scale-110 transition-transform" /> : <FileText className="text-zinc-600" />}
                <span className="text-[9px] mt-2 truncate w-full text-center">{f.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* PREVIEW PANEL */}
        <div className="bg-zinc-900 border border-green-900 rounded-lg p-4 h-[600px] flex flex-col">
            <div className="flex items-center gap-2 text-xs border-b border-green-800 pb-2 mb-2">
                <Terminal size={14}/> <span>INSPECTOR</span>
            </div>
            {preview ? (
                <pre className="text-[10px] text-zinc-400 overflow-auto flex-1 leading-tight">
                    {preview.content.substring(0, 5000)}
                </pre>
            ) : <div className="text-zinc-800 text-[10px] italic">Select a file to visualize its raw hex/text data...</div>}
        </div>
      </div>
    </div>
  );
}