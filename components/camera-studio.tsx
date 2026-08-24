"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteMediaBlob, getMediaBlob, putMediaBlob } from '@/lib/idb';
import { pollSignals, postSignal, rtcConfig } from '@/lib/rtc';
import type { AnyPhotoDevice, CaptureSession, RemoteCommand } from '@/lib/types';

type Props = { device: AnyPhotoDevice; onMediaChanged: () => void };

type PendingDelete = Record<string, boolean>;

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
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [status, setStatus] = useState('Preparando câmera…');
  const [recording, setRecording] = useState<'idle'|'recording'|'paused'>('idle');
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [focusRange, setFocusRange] = useState<{min:number;max:number;step:number}|null>(null);
  const [focus, setFocus] = useState(0);
  const [exposureRange, setExposureRange] = useState<{min:number;max:number;step:number}|null>(null);
  const [exposure, setExposure] = useState(0);

  const publishMedia = useCallback(async (blob: Blob, kind: 'photo'|'video', durationMs?: number) => {
    const video = videoRef.current;
    if (!video) return;
    const id = crypto.randomUUID();
    const localObjectKey = `source:${id}`;
    await putMediaBlob(localObjectKey, blob);
    const thumbnailDataUrl = await dataUrlFromVideo(video);
    const ext = kind === 'photo' ? 'jpg' : (blob.type.includes('mp4') ? 'mp4' : 'webm');
    await fetch('/api/media', {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({
        id, sessionId: session?.id ?? null, sourceDeviceId: device.id, kind,
        filename: `AnyPhoto-${new Date().toISOString().replace(/[:.]/g,'-')}.${ext}`,
        mimeType: blob.type || (kind === 'photo' ? 'image/jpeg' : 'video/webm'), byteSize: blob.size,
        durationMs: durationMs ?? null, width: video.videoWidth || null, height: video.videoHeight || null,
        localObjectKey, thumbnailDataUrl,
      }),
    });
    onMediaChanged();
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
    if (blob) await publishMedia(blob, 'photo');
  }, [publishMedia]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || recorderRef.current?.state === 'recording') return;
    const mimeType = supportedRecorderType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const duration = Math.max(0, Date.now() - recordStartedRef.current);
      setRecording('idle');
      await publishMedia(blob, 'video', duration);
    };
    recordStartedRef.current = Date.now();
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording('recording');
  }, [publishMedia]);

  const pauseRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === 'recording') { recorder.pause(); setRecording('paused'); }
    else if (recorder.state === 'paused') { recorder.resume(); setRecording('recording'); }
  }, []);

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

  const applyCameraConstraint = useCallback(async (advanced: Record<string, unknown>) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try { await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] }); } catch {}
  }, []);

  const handleCommand = useCallback(async (command: RemoteCommand | any) => {
    switch (command.command) {
      case 'PHOTO': await takePhoto(); break;
      case 'VIDEO_START': startRecording(); break;
      case 'VIDEO_PAUSE': pauseRecording(); break;
      case 'VIDEO_STOP': stopRecording(); break;
      case 'FOCUS': {
        const normalized=Math.max(0,Math.min(1,Number(command.payload?.value)));
        const value=focusRange ? focusRange.min + normalized*(focusRange.max-focusRange.min) : normalized;
        await applyCameraConstraint({ focusMode:'manual', focusDistance:value }); break;
      }
      case 'AUTO_FOCUS': await applyCameraConstraint({ focusMode:'continuous' }); break;
      case 'EXPOSURE': {
        const normalized=Math.max(-1,Math.min(1,Number(command.payload?.value)));
        const value=exposureRange ? exposureRange.min + ((normalized+1)/2)*(exposureRange.max-exposureRange.min) : normalized;
        await applyCameraConstraint({ exposureCompensation:value }); break;
      }
      case 'MEDIA_REQUEST': await sendMedia(String(command.payload?.mediaId), Boolean(command.payload?.deleteOriginal)); break;
      case 'MEDIA_TRANSFER_ACK': if (pendingDeleteRef.current[String(command.payload?.mediaId)]) { await deleteLocal(String(command.payload?.mediaId)); delete pendingDeleteRef.current[String(command.payload?.mediaId)]; } break;
      case 'MEDIA_DELETE_LOCAL': await deleteLocal(String(command.payload?.mediaId)); break;
    }
  }, [applyCameraConstraint, deleteLocal, exposureRange, focusRange, pauseRecording, sendMedia, startRecording, stopRecording, takePhoto]);

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
    const caps = stream.getVideoTracks()[0]?.getCapabilities() as any;
    if (caps?.focusDistance) { setFocusRange(caps.focusDistance); setFocus(caps.focusDistance.min); }
    else setFocusRange(null);
    if (caps?.exposureCompensation) { setExposureRange(caps.exposureCompensation); setExposure(Math.max(caps.exposureCompensation.min, Math.min(0, caps.exposureCompensation.max))); }
    else setExposureRange(null);
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

  return (
    <section className="camera-mode">
      <div className="camera-preview glass">
        <video ref={videoRef} autoPlay muted playsInline />
        <div className="live-badge"><span /> {recording === 'recording' ? 'REC' : recording === 'paused' ? 'PAUSADO' : 'CAMERA'}</div>
        <div className="camera-status">{status}</div>
      </div>
      <aside className="camera-local-controls glass">
        <h2>Este aparelho é a CÂMERA</h2>
        <p className="muted">Mantenha o app aberto e a tela ativa durante a captura.</p>
        {videoInputs.length > 1 && <label>Lente / câmera<select value={selectedCamera} onChange={(e)=>startCamera(e.target.value)}>{videoInputs.map((item,i)=><option key={item.deviceId} value={item.deviceId}>{item.label || `Câmera ${i+1}`}</option>)}</select></label>}
        {focusRange && <label>Foco manual <input type="range" min={focusRange.min} max={focusRange.max} step={focusRange.step || 0.01} value={focus} onChange={(e)=>{ const v=Number(e.target.value); setFocus(v); applyCameraConstraint({focusMode:'manual',focusDistance:v}); }} /></label>}
        {exposureRange && <label>Brilho / exposição <input type="range" min={exposureRange.min} max={exposureRange.max} step={exposureRange.step || 0.1} value={exposure} onChange={(e)=>{ const v=Number(e.target.value); setExposure(v); applyCameraConstraint({exposureCompensation:v}); }} /></label>}
        <div className="button-row">
          <button className="button" onClick={takePhoto}>Foto local</button>
          <button className="button" onClick={recording==='idle'?startRecording:pauseRecording}>{recording==='idle'?'Gravar':recording==='recording'?'Pausar':'Continuar'}</button>
          {recording!=='idle' && <button className="button danger" onClick={stopRecording}>Parar</button>}
        </div>
      </aside>
    </section>
  );
}
