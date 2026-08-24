"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteMediaBlob, getMediaBlob, putMediaBlob } from '@/lib/idb';
import { pollSignals, postSignal, rtcConfig } from '@/lib/rtc';
import type { AnyPhotoDevice, CaptureSession, RemoteCommand } from '@/lib/types';

type Props = { device: AnyPhotoDevice; onMediaChanged: () => void };
type PendingDelete = Record<string, boolean>;
type CaptureState = 'idle' | 'recording' | 'paused';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function supportedRecorderType() {
  const candidates = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return candidates.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) || '';
}

async function dataUrlFromVideo(video: HTMLVideoElement, maxWidth = 420) {
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.62);
}

export default function CameraStudio({ device, onMediaChanged }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recordStartedRef = useRef(0);
  const pendingDeleteRef = useRef<PendingDelete>({});
  const lastSignalRef = useRef(0);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const toastTimerRef = useRef<number | null>(null);
  const recordingRef = useRef<CaptureState>('idle');
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [status, setStatus] = useState('Preparando câmera…');
  const [recording, setRecording] = useState<CaptureState>('idle');
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const notifyController = useCallback((message: Record<string, unknown>) => {
    const channel = channelRef.current;
    if (channel?.readyState === 'open') channel.send(JSON.stringify(message));
  }, []);

  useEffect(() => { recordingRef.current = recording; }, [recording]);
  useEffect(() => () => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
  }, []);

  const publishMedia = useCallback(async (blob: Blob, kind: 'photo'|'video', durationMs?: number) => {
    const video = videoRef.current;
    if (!video) throw new Error('Prévia da câmera indisponível');
    const id = crypto.randomUUID();
    const localObjectKey = `source:${id}`;
    await putMediaBlob(localObjectKey, blob);
    const thumbnailDataUrl = await dataUrlFromVideo(video);
    const ext = kind === 'photo' ? 'jpg' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
    const response = await fetch('/api/media', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({
        id, sessionId: session?.id ?? null, sourceDeviceId: device.id, kind,
        filename: `AnyPhoto-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,
        mimeType: blob.type || (kind === 'photo' ? 'image/jpeg' : 'video/webm'), byteSize: blob.size,
        durationMs: durationMs ?? null, width: video.videoWidth || null, height: video.videoHeight || null,
        localObjectKey, thumbnailDataUrl,
      }),
    });
    if (!response.ok) throw new Error('Falha ao salvar a mídia na galeria');
    onMediaChanged();
    return id;
  }, [device.id, onMediaChanged, session?.id]);

  const takePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    const track = streamRef.current?.getVideoTracks()[0];
    let blob: Blob | null = null;
    try {
      const ImageCaptureCtor = (window as any).ImageCapture;
      if (track && ImageCaptureCtor) blob = await new ImageCaptureCtor(track).takePhoto();
    } catch {}
    if (!blob) {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.94));
    }
    if (!blob) return;
    try {
      await publishMedia(blob, 'photo');
      showToast('Foto tirada e salva na galeria.');
      notifyController({ type:'CAPTURE_SAVED', kind:'photo' });
    } catch {
      showToast('Não foi possível salvar a foto.');
    }
  }, [notifyController, publishMedia, showToast]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const existing = recorderRef.current;
    if (!stream || (existing && existing.state !== 'inactive')) return;
    const mimeType = supportedRecorderType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const duration = Math.max(0, Date.now() - recordStartedRef.current);
      setRecording('idle');
      notifyController({ type:'CAPTURE_STATUS', state:'idle' });
      try {
        await publishMedia(blob, 'video', duration);
        showToast('Vídeo gravado e salvo na galeria.');
        notifyController({ type:'CAPTURE_SAVED', kind:'video' });
      } catch {
        showToast('Não foi possível salvar o vídeo.');
      }
    };
    recordStartedRef.current = Date.now();
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording('recording');
    notifyController({ type:'CAPTURE_STATUS', state:'recording' });
  }, [notifyController, publishMedia, showToast]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') {
      recorder.pause();
      setRecording('paused');
      notifyController({ type:'CAPTURE_STATUS', state:'paused' });
    } else if (recorder.state === 'paused') {
      recorder.resume();
      setRecording('recording');
      notifyController({ type:'CAPTURE_STATUS', state:'recording' });
    }
  }, [notifyController]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const deleteLocal = useCallback(async (mediaId: string) => {
    await deleteMediaBlob(`source:${mediaId}`);
    await fetch(`/api/media/${mediaId}`, { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({transferStatus:'transferred', originalRetained:false}) });
  }, []);

  const sendMedia = useCallback(async (mediaId: string, deleteOriginal: boolean) => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== 'open') return;
    const blob = await getMediaBlob(`source:${mediaId}`);
    if (!blob) {
      channel.send(JSON.stringify({ type:'MEDIA_TRANSFER_ERROR', mediaId, message:'Arquivo não está mais neste aparelho.' }));
      return;
    }
    const chunkSize = 48 * 1024;
    channel.send(JSON.stringify({ type:'MEDIA_TRANSFER_START', mediaId, mimeType:blob.type, size:blob.size, deleteOriginal }));
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      while (channel.bufferedAmount > 8 * 1024 * 1024) await sleep(40);
      channel.send(await blob.slice(offset, Math.min(offset + chunkSize, blob.size)).arrayBuffer());
    }
    pendingDeleteRef.current[mediaId] = deleteOriginal;
    channel.send(JSON.stringify({ type:'MEDIA_TRANSFER_END', mediaId }));
  }, []);

  const handleCommand = useCallback(async (command: RemoteCommand | any) => {
    switch (command.command) {
      case 'PHOTO': await takePhoto(); break;
      case 'VIDEO_START': startRecording(); break;
      case 'VIDEO_PAUSE': pauseRecording(); break;
      case 'VIDEO_STOP': stopRecording(); break;
      case 'MEDIA_REQUEST': await sendMedia(String(command.payload?.mediaId), Boolean(command.payload?.deleteOriginal)); break;
      case 'MEDIA_TRANSFER_ACK': if (pendingDeleteRef.current[String(command.payload?.mediaId)]) { await deleteLocal(String(command.payload?.mediaId)); delete pendingDeleteRef.current[String(command.payload?.mediaId)]; } break;
      case 'MEDIA_DELETE_LOCAL': await deleteLocal(String(command.payload?.mediaId)); break;
    }
  }, [deleteLocal, pauseRecording, sendMedia, startRecording, stopRecording, takePhoto]);

  const startCamera = useCallback(async (deviceId?: string) => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const constraints: MediaStreamConstraints = {
      video: deviceId ? { deviceId: { exact: deviceId }, width:{ideal:1920}, height:{ideal:1080} } : { facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080} },
      audio: true,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    streamRef.current = stream;
    if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(()=>{}); }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((item) => item.kind === 'videoinput');
    setVideoInputs(cameras);
    const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId || '';
    setSelectedCamera(activeId);
    const peer=peerRef.current;
    if(peer){
      for(const kind of ['video','audio'] as const){
        const nextTrack=kind==='video'?stream.getVideoTracks()[0]:stream.getAudioTracks()[0];
        const sender=peer.getSenders().find((item)=>item.track?.kind===kind);
        if(sender && nextTrack) await sender.replaceTrack(nextTrack).catch(()=>{});
      }
    }
    setStatus('Câmera pronta. Aguardando CONTROLE.');
  }, []);

  useEffect(() => {
    startCamera().catch((error) => setStatus(`Permissão de câmera necessária: ${error instanceof Error ? error.message : 'erro'}`));
    return () => { streamRef.current?.getTracks().forEach((track) => track.stop()); peerRef.current?.close(); };
  }, [startCamera]);

  useEffect(() => {
    let sentinel: any = null;
    let cancelled = false;
    const requestWakeLock = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      try {
        const wakeLock = (navigator as any).wakeLock;
        if (wakeLock?.request) sentinel = await wakeLock.request('screen');
      } catch {}
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') requestWakeLock(); };
    requestWakeLock();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release?.().catch?.(() => {});
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch(`/api/sessions/active?deviceId=${device.id}`, { cache:'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as CaptureSession | null;
      setSession((current) => {
        if (!next) return null;
        if (
          current?.id === next.id &&
          current.controller_device_id === next.controller_device_id &&
          current.status === next.status
        ) return current;
        return next;
      });
    }, 1400);
    return () => clearInterval(timer);
  }, [device.id]);

  useEffect(() => {
    if (!session) { peerRef.current?.close(); peerRef.current=null; channelRef.current=null; lastSignalRef.current=0; return; }
    let cancelled = false;
    const ensurePeer = () => {
      if (peerRef.current) return peerRef.current;
      const pc = new RTCPeerConnection(rtcConfig());
      peerRef.current = pc;
      streamRef.current?.getTracks().forEach((track) => pc.addTrack(track, streamRef.current!));
      pc.onicecandidate = (event) => { if (event.candidate) postSignal({ sessionId:session.id, fromDeviceId:device.id, toDeviceId:session.controller_device_id, messageType:'ice', payload:event.candidate.toJSON() }).catch(()=>{}); };
      pc.onconnectionstatechange = () => setStatus(pc.connectionState === 'connected' ? 'Ao vivo · conectado ao CONTROLE' : `WebRTC: ${pc.connectionState}`);
      pc.ondatachannel = (event) => {
        channelRef.current = event.channel;
        event.channel.binaryType = 'arraybuffer';
        const syncState = () => {
          if(event.channel.readyState==='open') event.channel.send(JSON.stringify({ type:'CAPTURE_STATUS', state:recordingRef.current }));
        };
        event.channel.onopen = syncState;
        if(event.channel.readyState==='open') syncState();
        event.channel.onmessage = (message) => { if (typeof message.data === 'string') { try { handleCommand(JSON.parse(message.data)); } catch {} } };
      };
      return pc;
    };
    const loop = async () => {
      while (!cancelled) {
        try {
          const messages = await pollSignals(device.id, session.id, lastSignalRef.current);
          for (const message of messages) {
            lastSignalRef.current = Math.max(lastSignalRef.current, Number(message.id));
            const pc = ensurePeer();
            if (message.message_type === 'offer') {
              await pc.setRemoteDescription(message.payload);
              for(const candidate of pendingIceRef.current) await pc.addIceCandidate(candidate).catch(()=>{});
              pendingIceRef.current=[];
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await postSignal({ sessionId:session.id, fromDeviceId:device.id, toDeviceId:session.controller_device_id, messageType:'answer', payload:answer });
            } else if (message.message_type === 'ice') {
              if(pc.remoteDescription) await pc.addIceCandidate(message.payload).catch(()=>{});
              else pendingIceRef.current.push(message.payload);
            } else if (message.message_type === 'command') await handleCommand(message.payload);
          }
        } catch {}
        await sleep(550);
      }
    };
    loop();
    return () => { cancelled=true; peerRef.current?.close(); peerRef.current=null; channelRef.current=null; lastSignalRef.current=0; };
  }, [device.id, handleCommand, session]);

  const isRecording = recording !== 'idle';
  const activeCameraIndex=Math.max(0,videoInputs.findIndex(item=>item.deviceId===selectedCamera));

  return (
    <section className="camera-native">
      {toast&&<div className="capture-toast" role="status"><span>✓</span>{toast}</div>}
      <div className={`camera-live-shell app-surface ${isRecording?'is-recording':''}`}>
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="camera-native-top">
          <div className="camera-title-pill"><span className="camera-mini-icon"><Icon name="camera"/></span><span><small>CÂMERA ATIVA</small><strong>{device.name}</strong></span></div>
          <div className={`camera-connection ${session?'connected':'waiting'}`}><i/>{session?'Conectada ao CONTROLE':'Aguardando sessão'}</div>
        </div>
        {isRecording&&<div className="recording-indicator camera-recording"><span/>{recording==='paused'?'PAUSADO':'REC'}</div>}
        <div className="camera-tech-overlay"><span>LIVE</span><span>WebRTC</span><span>{streamRef.current?.getVideoTracks()[0]?.getSettings().width||'—'}p</span></div>
        {videoInputs.length>1&&<div className="lens-rail">{videoInputs.map((item,index)=><button key={item.deviceId} className={selectedCamera===item.deviceId?'active':''} onClick={()=>startCamera(item.deviceId)} title={item.label||`Câmera ${index+1}`}>{index===activeCameraIndex?'1×':index+1}</button>)}</div>}
        <div className="camera-status-native"><span className={`status-light ${session?'connected':'waiting'}`}/><span>{status}</span></div>
      </div>

      <div className="camera-native-console app-surface">
        <div className="camera-console-meta">
          <div><span className="section-overline">CAPTURA LOCAL</span><strong>{isRecording?(recording==='paused'?'Gravação pausada':'Gravando agora'):'Pronta para capturar'}</strong></div>
          <div className="camera-session-chip">{session?`Sessão ${session.id.slice(0,8)}`:'Sem sessão ativa'}</div>
        </div>
        <div className="native-capture-controls">
          <button className="native-side-control" disabled={!isRecording} onClick={pauseRecording}><span><Icon name={recording==='paused'?'play':'pause'}/></span><small>{recording==='paused'?'Continuar':'Pausar'}</small></button>
          <button className="native-shutter" onClick={takePhoto} aria-label="Tirar foto"><span className="native-shutter-outer"><span className="native-shutter-inner"/></span><small>Foto</small></button>
          <button className={`native-record ${isRecording?'active':''}`} onClick={isRecording?stopRecording:startRecording}><span className="native-record-symbol"/><small>{isRecording?'STOP':'REC'}</small></button>
        </div>
        <div className="camera-console-foot"><span><Icon name="shield"/>Tela mantida ativa durante a captura</span><span>{videoInputs.length>1?`${videoInputs.length} lentes disponíveis`:'Câmera única'}</span></div>
      </div>
    </section>
  );
}

function Icon({name}:{name:'camera'|'play'|'pause'|'shield'}){
  const common={width:18,height:18,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.8,strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  if(name==='camera')return <svg {...common}><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13.5" r="4"/></svg>;
  if(name==='play')return <svg {...common}><path d="m8 5 11 7-11 7V5Z"/></svg>;
  if(name==='pause')return <svg {...common}><path d="M9 5v14M15 5v14"/></svg>;
  return <svg {...common}><path d="M12 3 4.5 6v5.5c0 4.7 3 7.6 7.5 9.5 4.5-1.9 7.5-4.8 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/></svg>;
}
