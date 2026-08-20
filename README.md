# AnyPhoto

AnyPhoto turns multiple phones, tablets or computers into a remotely controlled multi-camera studio. Sign in with the same account on every device, assign one as **CONTROLE** and the others as **CÂMERA**, then monitor live feeds and trigger capture remotely.

## MVP included

- Same-account multi-device login with Neon Managed Better Auth.
- Persistent per-browser device identity and switchable CONTROLE/CÂMERA role.
- Multiple simultaneous camera endpoints from a single controller.
- Peer-to-peer WebRTC live video/audio.
- RTCDataChannel remote commands: photo, record, pause/resume, stop, focus and exposure/brightness when supported by the device camera API.
- Shared Neon-backed media catalog with thumbnails.
- Local full-resolution media storage in IndexedDB on the source PWA.
- Peer-to-peer media transfer from CÂMERA to CONTROLE, with optional deletion of the AnyPhoto-managed source copy after confirmed receipt.
- Save/share action on the receiving device.
- Installable PWA shell and responsive mobile/desktop UI.
- São Paulo Vercel function region (`gru1`) to stay close to the project's Neon region.

## Environment

Copy `.env.example` to `.env.local` and configure:

- `DATABASE_URL`: pooled Neon Postgres connection string for the `production` branch.
- `NEON_AUTH_BASE_URL`: already provisioned for the AnyPhoto Neon project.
- `NEON_AUTH_COOKIE_SECRET`: high-entropy 32+ character secret.
- `NEXT_PUBLIC_STUN_URL`: defaults to Google's public STUN endpoint.
- `NEXT_PUBLIC_TURN_*`: strongly recommended for reliable remote connectivity outside friendly networks.

Never commit `.env.local`.

## Local development

```bash
npm install
npm run dev
```

Camera access requires a secure context. `localhost` is accepted by browsers; for testing from another physical device, use an HTTPS development URL/tunnel or a Vercel Preview deployment.

## Database

The application schema is documented in `db/schema.sql`. The production Neon project is `dry-bread-29053407`; schema changes should be promoted through Neon's migration workflow rather than executed ad hoc.

## Deployment

The repository is designed for Next.js 16 on Vercel. Add all environment variables to Development, Preview and Production, link the Git repository to the `any-photo` Vercel project, then deploy.

## Important limitations

See `ARCHITECTURE.md`. In particular: browsers cannot silently write/delete arbitrary media in the native phone gallery, STUN-only WebRTC is not sufficient for every network, and manual camera controls vary by browser/hardware.
