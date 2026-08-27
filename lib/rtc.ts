"use client";

export function rtcConfig(): RTCConfiguration {
  const configuredStun = process.env.NEXT_PUBLIC_STUN_URL
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const iceServers: RTCIceServer[] = [
    {
      urls: configuredStun?.length
        ? configuredStun
        : [
            'stun:stun.l.google.com:19302',
            'stun:stun1.l.google.com:19302',
            'stun:stun.cloudflare.com:3478',
          ],
    },
  ];

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return {
    iceServers,
    iceCandidatePoolSize: 2,
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  };
}

export async function postSignal(input: {
  sessionId: string;
  fromDeviceId: string;
  toDeviceId: string;
  messageType: 'offer' | 'answer' | 'ice' | 'command' | 'ack';
  payload: unknown;
}) {
  const response = await fetch('/api/signal', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('Falha na sinalização WebRTC');
}

export async function pollSignals(deviceId: string, sessionId: string, after: number) {
  const query = new URLSearchParams({ deviceId, sessionId, after: String(after) });
  const response = await fetch(`/api/signal?${query}`, { cache: 'no-store' });
  if (!response.ok) return [] as Array<any>;
  return response.json() as Promise<Array<any>>;
}
