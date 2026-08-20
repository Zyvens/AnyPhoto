import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const sql = db();
  await sql`
    INSERT INTO public.command_events (user_id, session_id, from_device_id, to_device_id, command, payload)
    VALUES (${user.id}, ${body.sessionId ? String(body.sessionId) : null}::uuid, ${String(body.fromDeviceId)}::uuid, ${String(body.toDeviceId)}::uuid,
      ${String(body.command).slice(0,80)}, ${JSON.stringify(body.payload || {})}::jsonb)`;
  return NextResponse.json({ ok: true }, { status: 201 });
}
