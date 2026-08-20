import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const controllerId = String(body.controllerDeviceId || '');
  const cameraIds = Array.isArray(body.cameraDeviceIds) ? body.cameraDeviceIds.map(String) : [];
  if (!controllerId || !cameraIds.length) return NextResponse.json({ error: 'controller and cameras required' }, { status: 400 });
  const sql = db();
  const [controller] = await sql`SELECT id FROM public.devices WHERE id=${controllerId}::uuid AND user_id=${user.id} AND role='control'`;
  if (!controller) return NextResponse.json({ error: 'invalid controller' }, { status: 400 });
  for (const cameraId of cameraIds) {
    const [camera] = await sql`SELECT id FROM public.devices WHERE id=${cameraId}::uuid AND user_id=${user.id} AND role='camera'`;
    if (!camera) return NextResponse.json({ error: `invalid camera ${cameraId}` }, { status: 400 });
  }
  await sql`UPDATE public.capture_sessions SET status='stopped', stopped_at=now() WHERE user_id=${user.id} AND controller_device_id=${controllerId}::uuid AND status='active'`;
  const [session] = await sql`
    INSERT INTO public.capture_sessions (user_id, name, controller_device_id)
    VALUES (${user.id}, ${String(body.name || 'Sessão AnyPhoto').slice(0,100)}, ${controllerId}::uuid)
    RETURNING id, name, status, controller_device_id, created_at`;
  for (let i = 0; i < cameraIds.length; i++) {
    await sql`INSERT INTO public.session_cameras (session_id, camera_device_id, position_index) VALUES (${session.id}::uuid, ${cameraIds[i]}::uuid, ${i})`;
  }
  return NextResponse.json(session, { status: 201 });
}
