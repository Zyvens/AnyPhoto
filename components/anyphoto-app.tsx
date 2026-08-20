"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { getMediaBlob } from '@/lib/idb';
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

  if(loading||!device)return <main className="loading-screen"><div className="brand-mark pulse">◎</div><p>Conectando seus aparelhos…</p></main>;

  return <main className="app-shell">
    <header className="topbar glass"><div className="brand"><div className="brand-mark small">◎</div><div><strong>AnyPhoto</strong><span>remote studio</span></div></div><nav><button className={tab==='studio'?'active':''} onClick={()=>setTab('studio')}>Estúdio</button><button className={tab==='gallery'?'active':''} onClick={()=>setTab('gallery')}>Galeria <span className="count">{media.length}</span></button></nav><div className="account"><button className="device-name" onClick={rename}>{device.name}</button><button className="icon-button" onClick={()=>authClient.signOut().then(()=>location.assign('/auth/sign-in'))}>Sair</button></div></header>

    {device.role==='unassigned'?<section className="role-gate"><p className="eyebrow">DEFINA ESTE APARELHO</p><h1>O que ele fará agora?</h1><p className="muted">Você pode trocar a função depois. Use CONTROLE no aparelho que ficará na sua mão e CÂMERA nos aparelhos posicionados.</p><div className="role-grid"><button className="role-card glass" onClick={()=>setRole('control')}><span className="role-icon">⌁</span><strong>CONTROLE</strong><small>Ver todas as câmeras, fotografar, gravar, pausar, ajustar e transferir mídia.</small></button><button className="role-card glass" onClick={()=>setRole('camera')}><span className="role-icon">◉</span><strong>CÂMERA</strong><small>Compartilhar vídeo ao vivo e obedecer aos comandos remotos deste login.</small></button></div></section>:
    <>
      <div className="mode-strip"><span>Este aparelho:</span><button className={device.role==='control'?'selected':''} onClick={()=>setRole('control')}>CONTROLE</button><button className={device.role==='camera'?'selected':''} onClick={()=>setRole('camera')}>CÂMERA</button></div>
      {device.role==='camera' && tab==='studio' && <CameraStudio device={device} onMediaChanged={refreshMedia}/>}
      {device.role==='control' && <div className={tab==='studio'?'':'hidden-panel'}><ControllerStudio device={device} cameras={cameras} media={media} onMediaChanged={refreshMedia} onLocalMedia={(id,url)=>setLocalUrls(s=>({...s,[id]:url}))}/></div>}
      {tab==='gallery'&&<Gallery media={media} devices={devices} localUrls={localUrls} onMediaChanged={refreshMedia} onTransfer={requestGalleryTransfer}/>} 
    </>}
  </main>;
}

function Gallery({media,devices,localUrls,onMediaChanged,onTransfer}:{media:MediaItem[];devices:AnyPhotoDevice[];localUrls:Record<string,string>;onMediaChanged:()=>void;onTransfer:(item:MediaItem,deleteOriginal:boolean)=>void}){
  const deleteItem=async(item:MediaItem)=>{if(!confirm('Excluir esta mídia da galeria AnyPhoto?'))return;window.dispatchEvent(new CustomEvent('anyphoto-delete',{detail:{item}}));await fetch(`/api/media/${item.id}`,{method:'DELETE'});onMediaChanged()};
  return <section className="gallery-section"><div className="section-title"><div><p className="eyebrow">GALERIA COMPARTILHADA</p><h1>Capturas da sua conta</h1></div><p className="muted">Capas ficam sincronizadas pelo Neon. O arquivo original permanece no aparelho de origem até você transferi-lo.</p></div>{!media.length?<div className="empty glass"><span>◎</span><h3>Nenhuma captura ainda</h3><p>Abra o Estúdio, conecte uma câmera e faça a primeira foto.</p></div>:<div className="media-grid">{media.map((item)=>{const source=devices.find(d=>d.id===item.source_device_id);const localUrl=localUrls[item.id];return <article className="media-card glass" key={item.id}><div className="media-preview">{localUrl?(item.kind==='video'?<video src={localUrl} controls playsInline/>:<img src={localUrl} alt="Captura AnyPhoto"/>):item.thumbnail_data_url?<img src={item.thumbnail_data_url} alt="Prévia AnyPhoto"/>:<div className="placeholder">◎</div>}<span className="kind-badge">{item.kind==='video'?'VÍDEO':'FOTO'}</span></div><div className="media-meta"><strong>{item.filename}</strong><span>{source?.name||item.source_name||'Câmera'} · {new Date(item.created_at).toLocaleString('pt-BR')}</span><span>{formatBytes(item.byte_size)} {item.original_retained?'· original na origem':'· origem removida'}</span></div><GalleryTransferActions item={item} online={Boolean(source?.online)} localUrl={localUrl} onTransfer={(deleteOriginal)=>onTransfer(item,deleteOriginal)} onDelete={()=>deleteItem(item)}/></article>})}</div>}</section>
}
function formatBytes(value:number){if(!value)return '0 B';const units=['B','KB','MB','GB'];const index=Math.min(units.length-1,Math.floor(Math.log(value)/Math.log(1024)));return `${(value/1024**index).toFixed(index?1:0)} ${units[index]}`}
