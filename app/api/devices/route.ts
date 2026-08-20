import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sql = db();
  const rows = await sql`
    SELECT id, device_key, name, role, capabilities, last_seen,
      (last_seen > now() - interval '20 seconds') AS online
    FROM public.devices
    WHERE user_id = ${user.id}
    ORDER BY online DESC, last_seen DESC`;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const deviceKey = String(body.deviceKey || '');
  const name = String(body.name || 'Dispositivo').slice(0, 80);
  const role = ['unassigned', 'control', 'camera'].includes(body.role) ? body.role : 'unassigned';
  if (!deviceKey) return NextResponse.json({ error: 'deviceKey required' }, { status: 400 });
  const sql = db();
  const rows = await sql`
    INSERT INTO public.devices (user_id, device_key, name, role, capabilities, last_seen, updated_at)
    VALUES (${user.id}, ${deviceKey}, ${name}, ${role}, ${JSON.stringify(body.capabilities || {})}::jsonb, now(), now())
    ON CONFLICT (user_id, device_key) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      capabilities = EXCLUDED.capabilities,
      last_seen = now(),
      updated_at = now()
    RETURNING id, device_key, name, role, capabilities, last_seen, true AS online`;
  return NextResponse.json(rows[0]);
}

export async function PATCH(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const role = ['unassigned', 'control', 'camera'].includes(body.role) ? body.role : 'unassigned';
  const sql = db();
  const rows = await sql`
    UPDATE public.devices SET name=${String(body.name || 'Dispositivo').slice(0,80)}, role=${role},
      capabilities=${JSON.stringify(body.capabilities || {})}::jsonb, last_seen=now(), updated_at=now()
    WHERE id=${String(body.id || '')}::uuid AND user_id=${user.id}
    RETURNING id, device_key, name, role, capabilities, last_seen, true AS online`;
  return rows[0] ? NextResponse.json(rows[0]) : NextResponse.json({ error: 'not found' }, { status: 404 });
}
