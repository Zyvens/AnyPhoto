"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { putMediaBlob } from '@/lib/idb';
import { pollSignals, postSignal, rtcConfig } from '@/lib/rtc';
import type { AnyPhotoDevice, CaptureSession, MediaItem } from '@/lib/types';

type Props = {
  device: AnyPhotoDevice;
  cameras: AnyPhotoDevice[];
  media: MediaItem[];
  onMediaChanged: () => void;
  onLocalMedia: (mediaId: string, url: string) => void;
};

type TransferState = { mediaId:string; mimeType:string; chunks:ArrayBuffer[]; deleteOriginal:boolean };
type CaptureState = 'idle' | 'recording' | 'paused';
const sleep=(ms:number)=>new Promise((r)=>setTimeout(r,ms));

export default function ControllerStudio({ device, cameras, media, onMediaChanged, onLocalMedia }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [session, setSession] = useState<CaptureSession|null>(null);
  const [streams, setStreams] = useState<Record<string,MediaStream>>({});
  const [connection, setConnection] = useState<Record<string,string>>({});
  const [recording, setRecording] = useState<Record<string,CaptureState>>({});
  const [toast, setToast] = useState<string|null>(null);
  const peersRef = useRef<Map<string,RTCPeerConnection>>(new Map());
  const channelsRef = useRef<Map<string,RTCDataChannel>>(new Map());
  const lastSignalRef = useRef(0);
  const transferRef = useRef<Record<string,TransferState|undefined>>({});
  const pendingIceRef = useRef<Record<string,RTCIceCandidateInit[]>>({});
  const toastTimerRef = useRef<number|null>(null);

  const showToast = useCallback((message:string)=>{
    setToast(message);
    if(toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(()=>setToast(null),3200);
  },[]);

  useEffect(()=>()=>{ if(toastTimerRef.current) window.clearTimeout(toastTimerRef.current); },[]);
  useEffect(()=>setSelected((current)=>current.filter((id)=>cameras.some((camera)=>camera.id===id))),[cameras]);

  const sendCommand = useCallback(async (cameraId:string, command:string, payload:Record<string,unknown>={}) => {
    if (!session) return;
    fetch('/api/commands',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId:session.id,fromDeviceId:device.id,toDeviceId:cameraId,command,payload})}).catch(()=>{});
    const channel=channelsRef.current.get(cameraId);
    const message={type:'command',command,payload};
    if (channel?.readyState==='open') channel.send(JSON.stringify(message));
    else await postSignal({sessionId:session.id,fromDeviceId:device.id,toDeviceId:cameraId,messageType:'command',payload:message});
  },[device.id,session]);

  const attachChannel = useCallback((cameraId:string, channel:RTCDataChannel)=>{
    channelsRef.current.set(cameraId,channel);
    channel.binaryType='arraybuffer';
    channel.onopen=()=>setConnection((s)=>({...s,[cameraId]:'connected'}));
    channel.onclose=()=>{
      setConnection((s)=>({...s,[cameraId]:'closed'}));
      setRecording((s)=>({...s,[cameraId]:'idle'}));
    };
    channel.onmessage=async(event)=>{
      if(typeof event.data==='string'){
        let message:any; try{message=JSON.parse(event.data)}catch{return}
        if(message.type==='CAPTURE_STATUS'){
          const state=String(message.state) as CaptureState;
          if(state==='idle'||state==='recording'||state==='paused') setRecording((s)=>({...s,[cameraId]:state}));
        }else if(message.type==='CAPTURE_SAVED'){
          const kind=String(message.kind);
          if(kind==='video') setRecording((s)=>({...s,[cameraId]:'idle'}));
          showToast(kind==='photo' ? 'Foto tirada e salva na galeria.' : 'Vídeo gravado e salvo na galeria.');
          onMediaChanged();
        }else if(message.type==='MEDIA_TRANSFER_START'){
          transferRef.current[cameraId]={mediaId:String(message.mediaId),mimeType:String(message.mimeType||'application/octet-stream'),chunks:[],deleteOriginal:Boolean(message.deleteOriginal)};
        }else if(message.type==='MEDIA_TRANSFER_END'){
          const transfer=transferRef.current[cameraId];
          if(!transfer || transfer.mediaId!==String(message.mediaId))return;
          const blob=new Blob(transfer.chunks,{type:transfer.mimeType});
          const key=`received:${transfer.mediaId}`;
          await putMediaBlob(key,blob);
          const url=URL.createObjectURL(blob);
          onLocalMedia(transfer.mediaId,url);
          await fetch(`/api/media/${transfer.mediaId}`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({transferStatus:'transferred',originalRetained:true})});
          if (channel.readyState === 'open') channel.send(JSON.stringify({type:'command',command:'MEDIA_TRANSFER_ACK',payload:{mediaId:transfer.mediaId}}));
          transferRef.current[cameraId]=undefined;
          onMediaChanged();
        }else if(message.type==='MEDIA_TRANSFER_ERROR') alert(message.message || 'Não foi possível transferir este arquivo.');
      }else if(event.data instanceof ArrayBuffer){
        const transfer=transferRef.current[cameraId]; if(transfer) transfer.chunks.push(event.data);
      }else if(event.data instanceof Blob){
        const transfer=transferRef.current[cameraId]; if(transfer) transfer.chunks.push(await event.data.arrayBuffer());
      }
    };
  },[onLocalMedia,onMediaChanged,showToast]);

  const createPeer = useCallback(async(cameraId:string, activeSession:CaptureSession)=>{
    peersRef.current.get(cameraId)?.close();
    const pc=new RTCPeerConnection(rtcConfig());
    peersRef.current.set(cameraId,pc);
    const channel=pc.createDataChannel('anyphoto-control',{ordered:true});
    attachChannel(cameraId,channel);
    pc.ontrack=(event)=>{ const stream=event.streams[0]; if(stream)setStreams((s)=>({...s,[cameraId]:stream})); };
    pc.onicecandidate=(event)=>{ if(event.candidate)postSignal({sessionId:activeSession.id,fromDeviceId:device.id,toDeviceId:cameraId,messageType:'ice',payload:event.candidate.toJSON()}).catch(()=>{}); };
    pc.onconnectionstatechange=()=>setConnection((s)=>({...s,[cameraId]:pc.connectionState}));
    const offer=await pc.createOffer({offerToReceiveAudio:true,offerToReceiveVideo:true});
    await pc.setLocalDescription(offer);
    await postSignal({sessionId:activeSession.id,fromDeviceId:device.id,toDeviceId:cameraId,messageType:'offer',payload:offer});
  },[attachChannel,device.id]);

  const startSession = async()=>{
    if(!selected.length)return;
    const response=await fetch('/api/sessions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({controllerDeviceId:device.id,cameraDeviceIds:selected,name:`Sessão ${new Date().toLocaleString('pt-BR')}`})});
    if(!response.ok){alert('Não foi possível iniciar a sessão.');return}
    const created=await response.json();
    setSession(created); lastSignalRef.current=0;
    setRecording(Object.fromEntries(selected.map((id)=>[id,'idle'])) as Record<string,CaptureState>);
    for(const cameraId of selected) await createPeer(cameraId,created);
  };

  const stopSession=async()=>{
    if(session)await fetch(`/api/sessions/${session.id}`,{method:'DELETE'});
    peersRef.current.forEach((pc)=>pc.close()); peersRef.current.clear(); channelsRef.current.clear();
    setStreams({});setConnection({});setRecording({});setSession(null);lastSignalRef.current=0;
  };

  useEffect(()=>{
    if(!session)return;
    let cancelled=false;
    const loop=async()=>{
      while(!cancelled){
        try{
          const messages=await pollSignals(device.id,session.id,lastSignalRef.current);
          for(const message of messages){
            lastSignalRef.current=Math.max(lastSignalRef.current,Number(message.id));
            const cameraId=String(message.from_device_id); const pc=peersRef.current.get(cameraId);
            if(!pc)continue;
            if(message.message_type==='answer'){
              await pc.setRemoteDescription(message.payload);
              for(const candidate of pendingIceRef.current[cameraId]||[]) await pc.addIceCandidate(candidate).catch(()=>{});
              pendingIceRef.current[cameraId]=[];
            } else if(message.message_type==='ice'){
              if(pc.remoteDescription) await pc.addIceCandidate(message.payload).catch(()=>{});
              else (pendingIceRef.current[cameraId] ||= []).push(message.payload);
            }
          }
        }catch{}
        await sleep(550);
      }
    };loop();return()=>{cancelled=true};
  },[device.id,session]);

  useEffect(()=>()=>{peersRef.current.forEach((pc)=>pc.close())},[]);

  const toggleRecording=useCallback((cameraId:string)=>{
    const isActive=(recording[cameraId]||'idle')!=='idle';
    const command=isActive?'VIDEO_STOP':'VIDEO_START';
    setRecording((s)=>({...s,[cameraId]:isActive?'idle':'recording'}));
    sendCommand(cameraId,command);
  },[recording,sendCommand]);

  const toggleAllRecording=useCallback(()=>{
    const shouldStop=selected.some((id)=>(recording[id]||'idle')!=='idle');
    selected.forEach((id)=>sendCommand(id,shouldStop?'VIDEO_STOP':'VIDEO_START'));
    setRecording((current)=>{
      const next={...current};
      selected.forEach((id)=>{next[id]=shouldStop?'idle':'recording'});
      return next;
    });
  },[recording,selected,sendCommand]);

  const requestTransfer=useCallback((item:MediaItem,deleteOriginal:boolean)=>{
    if(!session){ alert('Abra uma sessão com a câmera de origem para transferir o arquivo.'); return; }
    if(channelsRef.current.get(item.source_device_id)?.readyState!=='open'){ alert('A câmera de origem ainda não está conectada ao CONTROLE.'); return; }
    sendCommand(item.source_device_id,'MEDIA_REQUEST',{mediaId:item.id,deleteOriginal});
  },[sendCommand,session]);

  useEffect(()=>{
    const transfer=(event:Event)=>{ const detail=(event as CustomEvent<{item:MediaItem;deleteOriginal:boolean}>).detail; if(detail?.item) requestTransfer(detail.item,detail.deleteOriginal); };
    const remove=(event:Event)=>{ const detail=(event as CustomEvent<{item:MediaItem}>).detail; if(detail?.item && channelsRef.current.get(detail.item.source_device_id)?.readyState==='open') sendCommand(detail.item.source_device_id,'MEDIA_DELETE_LOCAL',{mediaId:detail.item.id}); };
    window.addEventListener('anyphoto-transfer',transfer); window.addEventListener('anyphoto-delete',remove);
    return()=>{window.removeEventListener('anyphoto-transfer',transfer);window.removeEventListener('anyphoto-delete',remove)};
  },[requestTransfer,sendCommand]);

  const anyRecording=selected.some((id)=>(recording[id]||'idle')!=='idle');

  return <section className="controller-mode">
    {toast&&<div className="capture-toast" role="status"><span>✓</span>{toast}</div>}
    <div className="camera-picker glass">
      <div><p className="eyebrow">CÂMERAS DISPONÍVEIS</p><h2>{cameras.filter(c=>c.online).length} online</h2></div>
      <div className="device-chips">{cameras.map((camera)=><label className={`device-chip ${camera.online?'online':'offline'}`} key={camera.id}><input type="checkbox" disabled={!camera.online||!!session} checked={selected.includes(camera.id)} onChange={(e)=>setSelected((s)=>e.target.checked?[...s,camera.id]:s.filter(id=>id!==camera.id))}/><span className="status-dot"/><span>{camera.name}</span></label>)}</div>
      {!session?<button className="button primary" disabled={!selected.length} onClick={startSession}>Abrir central ({selected.length})</button>:<button className="button danger" onClick={stopSession}>Encerrar sessão</button>}
      {session&&<div className="global-actions"><span>Todas:</span><button className="mini-button" onClick={()=>selected.forEach((id)=>sendCommand(id,'PHOTO'))}>Foto</button><button className={`mini-button ${anyRecording?'recording-action':''}`} onClick={toggleAllRecording}>{anyRecording?'STOP':'REC'}</button><button className="mini-button" disabled={!anyRecording} onClick={()=>selected.filter((id)=>(recording[id]||'idle')!=='idle').forEach((id)=>sendCommand(id,'VIDEO_PAUSE'))}>Pausar / continuar</button></div>}
    </div>

    {session&&<div className="remote-grid">{selected.map((cameraId)=>{const camera=cameras.find(c=>c.id===cameraId);const captureState=recording[cameraId]||'idle';const isRecording=captureState!=='idle';return <article className="remote-camera glass" key={cameraId}>
      <div className={`remote-video ${isRecording?'is-recording':''}`}><RemoteVideo stream={streams[cameraId]}/><div className="live-badge"><span/>{connection[cameraId]||'conectando'}</div>{isRecording&&<div className="recording-indicator"><span/>{captureState==='paused'?'PAUSADO':'REC'}</div>}</div>
      <div className="remote-head"><strong>{camera?.name||'Câmera'}</strong><span className="muted">{streams[cameraId]?'AO VIVO':'aguardando vídeo'}</span></div>
      <div className="remote-actions"><button className="round-action shutter" onClick={()=>sendCommand(cameraId,'PHOTO')} title="Tirar foto" aria-label="Tirar foto"><span className="shutter-core"/></button><button className={`round-action record-toggle ${isRecording?'active':''}`} onClick={()=>toggleRecording(cameraId)} title={isRecording?'Parar gravação':'Gravar'}>{isRecording?'STOP':'REC'}</button><button className="round-action pause-action" disabled={!isRecording} onClick={()=>sendCommand(cameraId,'VIDEO_PAUSE')} title={captureState==='paused'?'Continuar gravação':'Pausar gravação'}>{captureState==='paused'?'▶':'Ⅱ'}</button></div>
    </article>})}</div>}

    <div className="gallery-actions-hidden" aria-hidden />
    {session&&media.some((item)=>selected.includes(item.source_device_id))&&<div className="session-media-note muted">As capturas aparecem na galeria abaixo em poucos segundos.</div>}
  </section>;
}

function RemoteVideo({stream}:{stream?:MediaStream}){
  const ref=useRef<HTMLVideoElement>(null);useEffect(()=>{if(ref.current&&stream){ref.current.srcObject=stream;ref.current.play().catch(()=>{})}},[stream]);
  return <video ref={ref} autoPlay playsInline muted/>;
}

export function GalleryTransferActions({item,online,localUrl,onTransfer,onDelete}:{item:MediaItem;online:boolean;localUrl?:string;onTransfer:(deleteOriginal:boolean)=>void;onDelete:()=>void}){
  const share=async()=>{
    if(!localUrl)return;const blob=await fetch(localUrl).then(r=>r.blob());const file=new File([blob],item.filename,{type:item.mime_type});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:item.filename}).catch(()=>{})}
    else{const a=document.createElement('a');a.href=localUrl;a.download=item.filename;a.click()}
  };
  return <div className="media-actions">{localUrl?<button className="mini-button" onClick={share}>Salvar / compartilhar</button>:<><button className="mini-button" disabled={!online} onClick={()=>onTransfer(false)}>Transferir</button><button className="mini-button" disabled={!online} onClick={()=>onTransfer(true)}>Transferir + apagar origem</button></>}<button className="mini-button danger-text" onClick={onDelete}>Excluir</button></div>;
}
