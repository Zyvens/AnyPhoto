import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

async function sessionPayload(sql: ReturnType<typeof db>, id: string, userId: string) {
  const [session] = await sql`SELECT id, name, status, controller_device_id, created_at FROM public.capture_sessions WHERE id=${id}::uuid AND user_id=${userId}`;
  if (!session) return null;
  const cameras = await sql`
    SELECT d.id, d.device_key, d.name, d.role, d.capabilities, d.last_seen,
      (d.last_seen > now() - interval '12 seconds') AS online
    FROM public.session_cameras sc JOIN public.devices d ON d.id=sc.camera_device_id
    WHERE sc.session_id=${id}::uuid ORDER BY sc.position_index`;
  return { ...session, cameras };
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const sql = db();
  const payload = await sessionPayload(sql, id, user.id);
  return payload ? NextResponse.json(payload) : NextResponse.json({ error: 'not found' }, { status: 404 });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  const action = String(body.action || '');
  const cameraId = String(body.cameraDeviceId || '');
  if (!cameraId || !['add-camera','remove-camera'].includes(action)) return NextResponse.json({ error: 'invalid action' }, { status: 400 });
  const sql = db();
  const [session] = await sql`SELECT id FROM public.capture_sessions WHERE id=${id}::uuid AND user_id=${user.id} AND status='active'`;
  if (!session) return NextResponse.json({ error: 'active session not found' }, { status: 404 });

  if (action === 'add-camera') {
    const [camera] = await sql`SELECT id FROM public.devices WHERE id=${cameraId}::uuid AND user_id=${user.id} AND role='camera'`;
    if (!camera) return NextResponse.json({ error: 'invalid camera' }, { status: 400 });
    const [position] = await sql`SELECT COALESCE(MAX(position_index), -1) + 1 AS next_position FROM public.session_cameras WHERE session_id=${id}::uuid`;
    await sql`
      INSERT INTO public.session_cameras (session_id, camera_device_id, position_index)
      VALUES (${id}::uuid, ${cameraId}::uuid, ${Number(position.next_position || 0)})
      ON CONFLICT (session_id, camera_device_id) DO NOTHING`;
  } else {
    await sql`DELETE FROM public.session_cameras WHERE session_id=${id}::uuid AND camera_device_id=${cameraId}::uuid`;
  }

  const payload = await sessionPayload(sql, id, user.id);
  return NextResponse.json(payload);
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const sql = db();
  await sql`UPDATE public.capture_sessions SET status='stopped', stopped_at=now() WHERE id=${id}::uuid AND user_id=${user.id}`;
  return NextResponse.json({ ok: true });
}
