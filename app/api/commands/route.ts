import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const fromDeviceId = String(body.fromDeviceId || '');
  const toDeviceId = String(body.toDeviceId || '');
  const sessionId = body.sessionId ? String(body.sessionId) : null;
  if (!fromDeviceId || !toDeviceId) return NextResponse.json({ error: 'devices required' }, { status: 400 });
  const sql = db();
  const endpoints = await sql`
    SELECT id FROM public.devices
    WHERE user_id=${user.id} AND id IN (${fromDeviceId}::uuid, ${toDeviceId}::uuid)`;
  if (endpoints.length !== 2 && fromDeviceId !== toDeviceId) return NextResponse.json({ error: 'invalid devices' }, { status: 400 });
  if (sessionId) {
    const [session] = await sql`SELECT id FROM public.capture_sessions WHERE id=${sessionId}::uuid AND user_id=${user.id}`;
    if (!session) return NextResponse.json({ error: 'invalid session' }, { status: 400 });
  }
  await sql`
    INSERT INTO public.command_events (user_id, session_id, from_device_id, to_device_id, command, payload)
    VALUES (${user.id}, ${sessionId}::uuid, ${fromDeviceId}::uuid, ${toDeviceId}::uuid,
      ${String(body.command).slice(0,80)}, ${JSON.stringify(body.payload || {})}::jsonb)`;
  return NextResponse.json({ ok: true }, { status: 201 });
}
