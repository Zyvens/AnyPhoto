import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('deviceId');
  const sessionId = searchParams.get('sessionId');
  const after = Number(searchParams.get('after') || 0);
  if (!deviceId || !sessionId) return NextResponse.json([]);
  const sql = db();
  const rows = await sql`
    SELECT id, from_device_id, to_device_id, message_type, payload, created_at
    FROM public.signaling_messages
    WHERE user_id=${user.id} AND session_id=${sessionId}::uuid AND to_device_id=${deviceId}::uuid
      AND id>${after} AND created_at > now() - interval '10 minutes'
    ORDER BY id ASC LIMIT 200`;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const allowed = ['offer','answer','ice','command','ack'];
  if (!allowed.includes(body.messageType)) return NextResponse.json({ error: 'invalid message type' }, { status: 400 });
  const sql = db();
  const [session] = await sql`SELECT id FROM public.capture_sessions WHERE id=${String(body.sessionId)}::uuid AND user_id=${user.id} AND status='active'`;
  if (!session) return NextResponse.json({ error: 'invalid session' }, { status: 400 });
  const endpoints = await sql`
    SELECT id FROM public.devices WHERE user_id=${user.id} AND id IN (${String(body.fromDeviceId)}::uuid, ${String(body.toDeviceId)}::uuid)`;
  if (endpoints.length !== 2 && String(body.fromDeviceId) !== String(body.toDeviceId)) return NextResponse.json({ error: 'invalid devices' }, { status: 400 });
  const [row] = await sql`
    INSERT INTO public.signaling_messages (user_id, session_id, from_device_id, to_device_id, message_type, payload)
    VALUES (${user.id}, ${String(body.sessionId)}::uuid, ${String(body.fromDeviceId)}::uuid, ${String(body.toDeviceId)}::uuid, ${body.messageType}, ${JSON.stringify(body.payload ?? {})}::jsonb)
    RETURNING id`;
  return NextResponse.json(row, { status: 201 });
}
