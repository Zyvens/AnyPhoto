"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { deleteMediaBlob, getMediaBlob } from '@/lib/idb';
import type { AnyPhotoDevice, DeviceRole, MediaItem } from '@/lib/types';
import CameraStudio from './camera-studio';
import ControllerStudio, { GalleryTransferActions } from './controller-studio';

export default function AnyPhotoApp({ userName }: { userName: string }) {
  const [device,setDevice]=useState<AnyPhotoDevice|null>(null);
  const [devices,setDevices]=useState<AnyPhotoDevice[]>([]);
  const [media,setMedia]=useState<MediaItem[]>([]);
  const [localUrls,setLocalUrls]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true);
  const [tab,setTab]=useState<'studio'|'gallery'>('studio');

  const refreshDevices=useCallback(async()=>{const r=await fetch('/api/devices',{cache:'no-store'});if(r.ok)setDevices(await r.json())},[]);
  const refreshMedia=useCallback(async()=>{const r=await fetch('/api/media',{cache:'no-store'});if(r.ok)setMedia(await r.json())},[]);

  useEffect(()=>{
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
    const init=async()=>{
      let key=localStorage.getItem('anyphoto.deviceKey');if(!key){key=crypto.randomUUID();localStorage.setItem('anyphoto.deviceKey',key)}
      const role=(localStorage.getItem('anyphoto.role') as DeviceRole)||'unassigned';
      const storedName=localStorage.getItem('anyphoto.deviceName');
      const fallback=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'Meu celular':'Meu computador';
      const response=await fetch('/api/devices',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({deviceKey:key,name:storedName||fallback,role,capabilities:{userAgent:navigator.userAgent.slice(0,180)}})});
      if(response.ok)setDevice(await response.json());
      await Promise.all([refreshDevices(),refreshMedia()]);setLoading(false);
    };init();
  },[refreshDevices,refreshMedia]);

  useEffect(()=>{if(!device)return;const timer=setInterval(()=>{fetch('/api/devices',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:device.id,name:device.name,role:device.role,capabilities:device.capabilities})}).catch(()=>{});refreshDevices()},5000);return()=>clearInterval(timer)},[device,refreshDevices]);
  useEffect(()=>{const timer=setInterval(refreshMedia,5000);return()=>clearInterval(timer)},[refreshMedia]);

  useEffect(()=>{media.forEach(async(item)=>{if(localUrls[item.id])return;const keys=[`received:${item.id}`,item.local_object_key||''].filter(Boolean);for(const key of keys){const blob=await getMediaBlob(key);if(blob){setLocalUrls(s=>({...s,[item.id]:URL.createObjectURL(blob)}));break}}})},[media,localUrls]);

  const cameras=useMemo(()=>devices.filter((item)=>item.role==='camera'&&item.id!==device?.id),[devices,device?.id]);
  const setRole=async(role:DeviceRole)=>{if(!device)return;localStorage.setItem('anyphoto.role',role);const response=await fetch('/api/devices',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:device.id,name:device.name,role,capabilities:device.capabilities})});if(response.ok){setDevice(await response.json());refreshDevices()}};
  const rename=async()=>{if(!device)return;const name=prompt('Nome deste aparelho',device.name)?.trim();if(!name)return;localStorage.setItem('anyphoto.deviceName',name);const response=await fetch('/api/devices',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:device.id,name,role:device.role,capabilities:device.capabilities})});if(response.ok)setDevice(await response.json())};

  const requestGalleryTransfer=(item:MediaItem,deleteOriginal:boolean)=>{
    window.dispatchEvent(new CustomEvent('anyphoto-transfer',{detail:{item,deleteOriginal}}));
  };

  if(loading||!device)return <main className="loading-screen"><div className="brand-orbit pulse"><span/></div><p>Preparando seu estúdio…</p></main>;

  return <main className="app-shell">
    <header className="topbar app-surface">
      <div className="brand-zone">
        <div className="brand-orbit small"><span/></div>
        <div className="brand-copy"><strong>AnyPhoto</strong><span>Remote camera studio</span></div>
      </div>
      <nav className="primary-nav" aria-label="Navegação principal">
        <button className={tab==='studio'?'active':''} onClick={()=>setTab('studio')}><Icon name="camera"/><span>Estúdio</span></button>
        <button className={tab==='gallery'?'active':''} onClick={()=>setTab('gallery')}><Icon name="grid"/><span>Galeria</span><b>{media.length}</b></button>
      </nav>
      <div className="account-zone">
        <button className="device-pill" onClick={rename} title="Renomear este aparelho"><span className="online-dot"/>{device.name}</button>
        <button className="icon-button premium" onClick={()=>authClient.signOut().then(()=>location.assign('/auth/sign-in'))} title="Sair"><Icon name="logout"/></button>
      </div>
    </header>

    {device.role==='unassigned'?<section className="role-gate">
      <div className="role-intro"><p className="eyebrow">COMECE POR AQUI</p><h1>Transforme qualquer aparelho em parte do seu estúdio.</h1><p className="muted">Use <strong>CONTROLE</strong> no dispositivo que fica com você e <strong>CÂMERA</strong> nos aparelhos posicionados para capturar novos ângulos.</p></div>
      <div className="role-grid">
        <button className="role-card app-surface" onClick={()=>setRole('control')}><span className="role-icon"><Icon name="monitor"/></span><span className="role-card-copy"><small>COMANDO CENTRAL</small><strong>CONTROLE</strong><em>Veja todas as câmeras ao vivo, fotografe, grave e organize a sessão em um só lugar.</em></span><span className="role-arrow">→</span></button>
        <button className="role-card app-surface" onClick={()=>setRole('camera')}><span className="role-icon"><Icon name="camera"/></span><span className="role-card-copy"><small>PONTO DE CAPTURA</small><strong>CÂMERA</strong><em>Compartilhe vídeo ao vivo e receba comandos remotos com baixa latência.</em></span><span className="role-arrow">→</span></button>
      </div>
    </section>:
    <>
      <div className="mode-strip app-surface"><span>Modo deste aparelho</span><div><button className={device.role==='control'?'selected':''} onClick={()=>setRole('control')}><Icon name="monitor"/>CONTROLE</button><button className={device.role==='camera'?'selected':''} onClick={()=>setRole('camera')}><Icon name="camera"/>CÂMERA</button></div></div>
      {device.role==='camera' && tab==='studio' && <CameraStudio device={device} onMediaChanged={refreshMedia}/>} 
      {device.role==='control' && <div className={tab==='studio'?'':'hidden-panel'}><ControllerStudio device={device} cameras={cameras} media={media} onMediaChanged={refreshMedia} onLocalMedia={(id,url)=>setLocalUrls(s=>({...s,[id]:url}))}/></div>}
      {tab==='gallery'&&<Gallery media={media} devices={devices} localUrls={localUrls} onMediaChanged={refreshMedia} onTransfer={requestGalleryTransfer}/>} 
    </>}
  </main>;
}

function Gallery({media,devices,localUrls,onMediaChanged,onTransfer}:{media:MediaItem[];devices:AnyPhotoDevice[];localUrls:Record<string,string>;onMediaChanged:()=>void;onTransfer:(item:MediaItem,deleteOriginal:boolean)=>void}){
  const [filter,setFilter]=useState<'all'|'photo'|'video'|'local'>('all');
  const deleteItem=async(item:MediaItem)=>{if(!confirm('Excluir esta mídia da galeria AnyPhoto?'))return;window.dispatchEvent(new CustomEvent('anyphoto-delete',{detail:{item}}));await Promise.allSettled([deleteMediaBlob(`received:${item.id}`),deleteMediaBlob(`source:${item.id}`)]);await fetch(`/api/media/${item.id}`,{method:'DELETE'});onMediaChanged()};
  const photos=media.filter(item=>item.kind==='photo').length;
  const videos=media.filter(item=>item.kind==='video').length;
  const onlineCameras=devices.filter(d=>d.role==='camera'&&d.online).length;
  const visible=media.filter(item=>filter==='all'||item.kind===filter||(filter==='local'&&Boolean(localUrls[item.id])));

  return <section className="gallery-section">
    <div className="gallery-hero app-surface">
      <div><div className="live-kicker"><span/>BIBLIOTECA SINCRONIZADA</div><h1>Suas capturas, todos os ângulos.</h1><p>Capas e metadados ficam sincronizados entre seus aparelhos. Transfira o original quando quiser editar, compartilhar ou arquivar.</p></div>
      <div className="gallery-stats"><span><b>{photos}</b>Fotos</span><span><b>{videos}</b>Vídeos</span><span><b>{onlineCameras}</b>Câmeras online</span></div>
    </div>

    <div className="gallery-toolbar app-surface">
      <div className="gallery-tabs">
        <button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>Todos</button>
        <button className={filter==='photo'?'active':''} onClick={()=>setFilter('photo')}>Fotos</button>
        <button className={filter==='video'?'active':''} onClick={()=>setFilter('video')}>Vídeos</button>
        <button className={filter==='local'?'active':''} onClick={()=>setFilter('local')}>Neste aparelho</button>
      </div>
      <div className="library-count"><Icon name="grid"/>{visible.length} itens</div>
    </div>

    {!visible.length?<div className="empty app-surface"><div className="empty-orbit"><span/></div><h3>{media.length?'Nenhum item neste filtro':'Sua galeria começa na próxima captura'}</h3><p>{media.length?'Escolha outro filtro para ver suas mídias.':'Abra o Estúdio, conecte uma câmera e faça a primeira foto ou vídeo.'}</p></div>:<div className="media-grid">{visible.map((item)=>{const source=devices.find(d=>d.id===item.source_device_id);const localUrl=localUrls[item.id];return <article className="media-card app-surface" key={item.id}>
      <div className="media-preview">{localUrl?(item.kind==='video'?<video src={localUrl} controls playsInline/>:<img src={localUrl} alt="Captura AnyPhoto"/>):item.thumbnail_data_url?<img src={item.thumbnail_data_url} alt="Prévia AnyPhoto"/>:<div className="placeholder"><Icon name="image"/></div>}<span className={`kind-badge ${item.kind}`}>{item.kind==='video'?<><Icon name="video"/>VÍDEO</>:<><Icon name="camera"/>FOTO</>}</span>{source?.online&&<span className="source-live"><i/> {source.name}</span>}</div>
      <div className="media-meta"><strong>{item.filename}</strong><span>{source?.name||item.source_name||'Câmera'} · {new Date(item.created_at).toLocaleString('pt-BR')}</span><span>{formatBytes(item.byte_size)} {item.original_retained?'· original na origem':'· origem removida'}</span></div>
      <GalleryTransferActions item={item} online={Boolean(source?.online)} localUrl={localUrl} onTransfer={(deleteOriginal)=>onTransfer(item,deleteOriginal)} onDelete={()=>deleteItem(item)}/>
    </article>})}</div>}
  </section>;
}

function Icon({name}:{name:'camera'|'grid'|'logout'|'monitor'|'image'|'video'}){
  const common={width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if(name==='camera')return <svg {...common}><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.5" r="4"/></svg>;
  if(name==='grid')return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>;
  if(name==='logout')return <svg {...common}><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5"/><path d="m15 8 4 4-4 4M19 12H9"/></svg>;
  if(name==='monitor')return <svg {...common}><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>;
  if(name==='video')return <svg {...common}><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>;
  return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>;
}

function formatBytes(value:number){if(!value)return '0 B';const units=['B','KB','MB','GB'];const index=Math.min(units.length-1,Math.floor(Math.log(value)/Math.log(1024)));return `${(value/1024**index).toFixed(index?1:0)} ${units[index]}`}
