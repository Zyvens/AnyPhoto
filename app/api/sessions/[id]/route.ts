import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const sql = db();
  const [session] = await sql`SELECT id, name, status, controller_device_id, created_at FROM public.capture_sessions WHERE id=${id}::uuid AND user_id=${user.id}`;
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const cameras = await sql`
    SELECT d.id, d.device_key, d.name, d.role, d.capabilities, d.last_seen,
      (d.last_seen > now() - interval '20 seconds') AS online
    FROM public.session_cameras sc JOIN public.devices d ON d.id=sc.camera_device_id
    WHERE sc.session_id=${id}::uuid ORDER BY sc.position_index`;
  return NextResponse.json({ ...session, cameras });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const sql = db();
  await sql`UPDATE public.capture_sessions SET status='stopped', stopped_at=now() WHERE id=${id}::uuid AND user_id=${user.id}`;
  return NextResponse.json({ ok: true });
}
