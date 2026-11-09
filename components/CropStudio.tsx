'use client';

import { ChangeEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

type ImageItem = { id: string; file: File; url: string; width: number; height: number; crop: Crop };
type Crop = { x: number; y: number; w: number; h: number };
const presets = [
  { label: 'Freeform', value: 'free' }, { label: 'Original', value: 'original' },
  { label: '1:1', value: '1:1' }, { label: '4:3', value: '4:3' }, { label: '3:2', value: '3:2' }, { label: '16:9', value: '16:9' },
];

function cropForRatio(width: number, height: number, ratio: number | null): Crop {
  if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
  const imageRatio = width / height;
  if (imageRatio > ratio) { const w = ratio / imageRatio; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  const h = imageRatio / ratio; return { x: 0, y: (1 - h) / 2, w: 1, h };
}

export default function CropStudio() {
  const [items, setItems] = useState<ImageItem[]>([]);
  const [activeId, setActiveId] = useState('');
  const [preset, setPreset] = useState('free');
  const [format, setFormat] = useState('image/jpeg');
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ x: number; y: number; start: Crop; mode: 'draw' | 'move' | 'resize'; handle?: string } | null>(null);
  const [notice, setNotice] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const cropFrameRef = useRef<number | null>(null);
  const pendingCropsRef = useRef(new Map<string, Crop>());
  const active = items.find((item) => item.id === activeId) ?? items[0];
  const ratio = preset === 'original' && active ? active.width / active.height : preset === 'free' ? null : Number(preset.split(':')[0]) / Number(preset.split(':')[1]);
  const output = useMemo(() => active ? `${Math.round(active.width * active.crop.w)} × ${Math.round(active.height * active.crop.h)}` : '—', [active]);

  useEffect(() => () => items.forEach((item) => URL.revokeObjectURL(item.url)), []); // files are revoked on unmount
  useEffect(() => () => { if (cropFrameRef.current !== null) cancelAnimationFrame(cropFrameRef.current); }, []);

  const addFiles = (files: FileList | File[]) => {
    const accepted = Array.from(files).filter((file) => file.type.startsWith('image/'));
    if (!accepted.length) { setNotice('Choose an image file to get started.'); return; }
    const pending = accepted.map((file) => new Promise<ImageItem>((resolve) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => resolve({ id: crypto.randomUUID(), file, url, width: img.naturalWidth, height: img.naturalHeight, crop: { x: 0, y: 0, w: 1, h: 1 } });
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null as unknown as ImageItem); }; img.src = url;
    }));
    Promise.all(pending).then((loaded) => {
      const good = loaded.filter(Boolean); setItems((old) => [...old, ...good]); setActiveId((id) => id || good[0]?.id || '');
      if (good.length) setNotice(`${good.length} image${good.length === 1 ? '' : 's'} added`);
    });
  };
  const changeFiles = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; };
  const updateCrop = (id: string, crop: Crop) => {
    pendingCropsRef.current.set(id, crop);
    if (cropFrameRef.current !== null) return;
    cropFrameRef.current = requestAnimationFrame(() => {
      const updates = new Map(pendingCropsRef.current);
      pendingCropsRef.current.clear(); cropFrameRef.current = null;
      setItems((old) => old.map((item) => updates.has(item.id) ? { ...item, crop: updates.get(item.id)! } : item));
    });
  };
  const selectPreset = (value: string) => {
    setPreset(value);
    if (!active || value === 'free') return;
    const targetRatio = value === 'original' ? active.width / active.height : Number(value.split(':')[0]) / Number(value.split(':')[1]);
    updateCrop(active.id, cropForRatio(active.width, active.height, targetRatio));
  };
  const pointFromEvent = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const startCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = pointFromEvent(event); setDrag({ ...p, start: active.crop, mode: 'draw' });
  };
  const startAdjust = (event: PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = pointFromEvent(event);
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    setDrag({ ...p, start: active.crop, mode: handle ? 'resize' : 'move', handle });
  };
  const moveCrop = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag || !active) return;
    const p = pointFromEvent(event);
    if (drag.mode === 'move') {
      const x = Math.max(0, Math.min(1 - drag.start.w, drag.start.x + p.x - drag.x));
      const y = Math.max(0, Math.min(1 - drag.start.h, drag.start.y + p.y - drag.y));
      updateCrop(active.id, { ...drag.start, x, y }); return;
    }
    if (drag.mode === 'resize') {
      const handle = drag.handle ?? 'se', fromLeft = handle.includes('w'), fromTop = handle.includes('n');
      const anchorX = fromLeft ? drag.start.x + drag.start.w : drag.start.x;
      const anchorY = fromTop ? drag.start.y + drag.start.h : drag.start.y;
      let w = Math.abs(p.x - anchorX), h = Math.abs(p.y - anchorY);
      const ratioInCoords = ratio ? ratio * active.height / active.width : null;
      if (ratioInCoords) {
        if (w / Math.max(h, 0.001) > ratioInCoords) h = w / ratioInCoords; else w = h * ratioInCoords;
      }
      const maxW = fromLeft ? anchorX : 1 - anchorX, maxH = fromTop ? anchorY : 1 - anchorY;
      if (ratioInCoords) { const scale = Math.min(1, maxW / Math.max(w, .001), maxH / Math.max(h, .001)); w *= scale; h *= scale; }
      else { w = Math.min(w, maxW); h = Math.min(h, maxH); }
      const x = fromLeft ? anchorX - w : anchorX, y = fromTop ? anchorY - h : anchorY;
      if (w > 0.015 && h > 0.015) updateCrop(active.id, { x, y, w, h });
      return;
    }
    let x = Math.min(drag.x, p.x), y = Math.min(drag.y, p.y), w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y);
    if (ratio) {
      const aspectInImageCoords = ratio * active.height / active.width;
      if (w / Math.max(h, 0.001) > aspectInImageCoords) w = h * aspectInImageCoords; else h = w / aspectInImageCoords;
      if (p.x < drag.x) x = drag.x - w; if (p.y < drag.y) y = drag.y - h;
    }
    if (w > 0.015 && h > 0.015) updateCrop(active.id, { x: Math.max(0, x), y: Math.max(0, y), w: Math.min(w, 1 - Math.max(0, x)), h: Math.min(h, 1 - Math.max(0, y)) });
  };
  const makeBlob = async (item: ImageItem, crop: Crop): Promise<Blob> => {
    const img = new Image(); img.src = item.url; await img.decode();
    const sx = Math.round(crop.x * item.width), sy = Math.round(crop.y * item.height);
    const sw = Math.max(1, Math.round(crop.w * item.width)), sh = Math.max(1, Math.round(crop.h * item.height));
    const canvas = document.createElement('canvas'); canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable');
    if (format === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sw, sh); }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Export failed')), format, quality / 100));
  };
  const download = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1500); };
  const exportOne = async () => {
    if (!active) return; setBusy(true);
    try { download(await makeBlob(active, active.crop), `${active.file.name.replace(/\.[^.]+$/, '')}-crop.${format === 'image/png' ? 'png' : 'jpg'}`); setNotice('Your cropped image is ready'); }
    catch { setNotice('Could not export this image. Try another file.'); } finally { setBusy(false); }
  };
  const exportAll = async () => {
    if (!items.length) return; setBusy(true); setNotice('Preparing your images…');
    const bulkRatio = preset === 'free' ? null : preset === 'original' ? null : Number(preset.split(':')[0]) / Number(preset.split(':')[1]);
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i], crop = bulkRatio ? cropForRatio(item.width, item.height, bulkRatio) : preset === 'free' ? item.crop : cropForRatio(item.width, item.height, null);
        const blob = await makeBlob(item, crop); download(blob, `${item.file.name.replace(/\.[^.]+$/, '')}-crop.${format === 'image/png' ? 'png' : 'jpg'}`);
        setNotice(`Exporting ${i + 1} of ${items.length}…`); await new Promise((resolve) => setTimeout(resolve, 180));
      }
      setNotice(`${items.length} images exported`);
    } catch { setNotice('An image could not be exported.'); } finally { setBusy(false); }
  };
  const removeItem = (id: string) => { const removed = items.find((item) => item.id === id); if (removed) URL.revokeObjectURL(removed.url); const next = items.filter((item) => item.id !== id); setItems(next); if (activeId === id) setActiveId(next[0]?.id ?? ''); };
  const removeAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]); setActiveId(''); setNotice('All images removed');
  };

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#"><span className="brand-mark"><svg viewBox="0 0 24 24" fill="none"><path d="M8 3v13a2 2 0 0 0 2 2h11M3 8h13a2 2 0 0 1 2 2v11" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><path d="M7 7h.01M17 17h.01" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg></span><span>crop<span className="brand-light">studio</span></span></a><div className="topbar-right"><span className="privacy"><span className="privacy-dot"/> Your images stay on your device</span><a className="top-link" href="#how-it-works">How it works <span>↗</span></a></div></header>
    <section className="intro"><div className="eyebrow"><span className="eyebrow-line"/> IMAGE EDITOR</div><h1>A better fit,<br/><span>in a few clicks.</span></h1><p>Crop one image or a whole batch. Simple tools, beautiful results, and your files never leave your device.</p></section>
    <section className="workspace" aria-label="Image crop workspace">
      <div className="toolbar"><div className="tabs"><button className="tab active"><span className="tab-icon">▧</span> Crop</button><span className="tab-divider"/><span className="toolbar-hint">{items.length ? `${items.length} image${items.length === 1 ? '' : 's'} in your workspace` : 'Make every image fit'}</span></div><div className="tool-actions"><button className="button button-quiet" onClick={() => inputRef.current?.click()}><span className="plus">＋</span> Add images</button><button className="button button-quiet single-export" disabled={!active || busy} onClick={exportOne}><span>↓</span> Export image</button><button className="button button-primary" disabled={!items.length || busy} onClick={exportAll}><span>⇩</span> {busy ? 'Exporting…' : `Export all${items.length ? ` (${items.length})` : ''}`}</button><input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={changeFiles}/></div></div>
      <div className="editor-grid"><section className="preview-pane"><div className="pane-heading"><div><span className="section-label">CANVAS</span><span className="section-title">{active ? active.file.name : 'Your image preview'}</span></div>{active && <span className="dimensions">{active.width} × {active.height} px</span>}</div>
        <div className={`preview-stage ${active ? 'has-image' : ''}`}>
          {active ? <div className="image-wrap"><img src={active.url} alt={active.file.name} draggable={false}/><div className="crop-overlay" onPointerDown={startCrop} onPointerMove={moveCrop} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}><div className="crop-box" onPointerDown={startAdjust} style={{ left: `${active.crop.x * 100}%`, top: `${active.crop.y * 100}%`, width: `${active.crop.w * 100}%`, height: `${active.crop.h * 100}%` }}><i data-handle="nw"/><i data-handle="ne"/><i data-handle="sw"/><i data-handle="se"/></div></div></div> : <div className="empty-state"><div className="upload-icon"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="8" width="34" height="32" rx="5" stroke="currentColor" strokeWidth="1.7"/><circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.7"/><path d="m9 34 10-10 7 7 5-5 8 8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg><span className="upload-plus">＋</span></div><h2>Your canvas is waiting</h2><p>Drop in an image to start shaping it.</p><button className="button button-upload" onClick={() => inputRef.current?.click()}>Browse images <span>↗</span></button><span className="file-note">JPG, PNG, WEBP · Multiple files welcome</span></div>}
          {active && <span className="stage-tip">Drag to adjust crop</span>}
        </div>
        {active && <div className="preview-footer"><span className="hint-mark">⌖</span> Drag frame to move · Pull a handle to resize <span className="footer-spacer"/><span className="output-size">OUTPUT <b>{output}</b></span></div>}
      </section>
      <aside className="settings-pane"><div className="settings-heading"><span className="section-label">ADJUST</span><span className="settings-count">01 <span>/</span> 03</span></div><div className="setting-block"><div className="setting-title-row"><span className="setting-title">Aspect ratio</span><span className="setting-note">{preset === 'free' ? 'CUSTOM' : preset.toUpperCase()}</span></div><div className="ratio-grid">{presets.map(({ label, value }) => <button key={value} className={`ratio-button ${preset === value ? 'selected' : ''}`} onClick={() => selectPreset(value)}><span className={`ratio-shape shape-${value.replace(':', '-')}`} />{label}</button>)}</div></div><div className="setting-block export-block"><div className="setting-title-row"><span className="setting-title">Export settings</span><span className="setting-note">02</span></div><label className="field-label" htmlFor="format">File format</label><div className="select-wrap"><select id="format" value={format} onChange={(event) => setFormat(event.target.value)}><option value="image/jpeg">JPG · smaller files</option><option value="image/png">PNG · lossless</option></select><span>⌄</span></div><div className="quality-row"><label className="field-label" htmlFor="quality">Quality</label><span className="quality-value">{quality}%</span></div><input id="quality" className="quality-slider" type="range" min="50" max="100" value={quality} onChange={(event) => setQuality(Number(event.target.value))} disabled={format === 'image/png'}/><div className="slider-labels"><span>Smaller file</span><span>Best quality</span></div></div><div className="setting-block batch-block"><div className="setting-title-row"><span className="setting-title">Batch crop</span><span className="setting-note">03</span></div><p>Apply <strong>{preset === 'free' ? 'each image’s current crop' : `${preset} crop`}</strong> to all {items.length || 'your'} images and download them together.</p><button className="batch-button" disabled={!items.length || busy} onClick={exportAll}><span>↧</span> Crop &amp; export all <b>{items.length}</b></button><div className="batch-foot"><span className="lock-icon">♧</span> Processed privately in your browser</div></div></aside></div>
      {items.length > 0 && <section className="filmstrip"><div className="filmstrip-head"><div><span className="section-label">YOUR IMAGES</span><span className="section-title">Ready to crop <span className="image-count">{String(items.length).padStart(2, '0')}</span></span></div><div className="filmstrip-actions"><button className="text-button delete-all-button" onClick={removeAll}>Delete all</button><button className="text-button" onClick={() => inputRef.current?.click()}>＋ Add more</button></div></div><div className="thumbnail-row">{items.map((item, index) => <button key={item.id} className={`thumbnail ${active?.id === item.id ? 'thumb-active' : ''}`} onClick={() => setActiveId(item.id)}><span className="thumb-img"><img src={item.url} alt=""/></span><span className="thumb-meta"><b>{item.file.name}</b><small>{item.width} × {item.height}</small></span><span className="thumb-index">{String(index + 1).padStart(2, '0')}</span><span className="remove-thumb" role="button" aria-label={`Remove ${item.file.name}`} onClick={(event) => { event.stopPropagation(); removeItem(item.id); }}>×</span></button>)}</div></section>}
    </section>
    {notice && <div className="notice" role="status" onClick={() => setNotice('')}>{notice}<button aria-label="Dismiss">×</button></div>}
    <footer className="page-footer" id="how-it-works"><span>Made for the little details.</span><span><span className="footer-spark">✳</span> No uploads. No fuss.</span></footer>
  </main>;
}
