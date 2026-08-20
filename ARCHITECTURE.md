# AnyPhoto — Architecture

## Goal

One authenticated account can be opened on many phones, tablets or computers. Each browser installation receives a persistent `device_key` and is assigned one of two roles: **CONTROLE** or **CÂMERA**. One CONTROLE can orchestrate several CÂMERAS simultaneously.

## Data plane vs control plane

- **Live video/audio:** WebRTC peer-to-peer from each CÂMERA to the CONTROLE. Video does not traverse Neon or Vercel.
- **Remote commands:** RTCDataChannel once the peer connection is established. Neon signaling is the fallback during connection setup.
- **Signaling/presence/catalog:** Next.js route handlers on Vercel + Neon Postgres.
- **Media binary:** IndexedDB in the PWA on the source device. Thumbnails and metadata are shared through Neon. Full files can be transferred peer-to-peer over RTCDataChannel to the CONTROLE and stored in that PWA's IndexedDB.
- **Authentication:** Neon Managed Better Auth proxied through `/api/auth/*`.

## Why the media is not stored in Postgres

Large video blobs would create unnecessary Postgres egress, storage pressure and database latency. This MVP keeps originals device-local and only synchronizes metadata/preview. A production cloud-gallery tier should add object storage (Vercel Blob or Neon Object Storage) with multipart/resumable uploads.

## Network reliability

The default configuration uses a public STUN server. Many networks connect successfully using STUN alone, but production-grade remote use across restrictive carrier/corporate NAT requires TURN. Configure `NEXT_PUBLIC_TURN_*` variables with a TURN service before relying on the app for critical events.

## Browser constraints

The web platform deliberately cannot delete arbitrary files from the user's native Photos/Gallery. AnyPhoto can delete media that **AnyPhoto itself stored in IndexedDB**. After a transfer, “Salvar / compartilhar” invokes the OS share sheet when supported; the final write into iOS Photos/Android Gallery remains an explicit user action.

Manual focus and exposure are feature-detected camera constraints. Chrome/Android typically exposes more controls than iOS Safari. Unsupported controls are ignored by the camera track rather than breaking capture.

PWAs can lose camera access when backgrounded, the screen locks, or the OS suspends the browser. Keep CÂMERA devices awake and AnyPhoto in the foreground while recording.
