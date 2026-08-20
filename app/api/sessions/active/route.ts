import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const deviceId = new URL(request.url).searchParams.get('deviceId');
  if (!deviceId) return NextResponse.json(null);
  const sql = db();
  const rows = await sql`
    SELECT s.id, s.name, s.status, s.controller_device_id, s.created_at
    FROM public.capture_sessions s
    JOIN public.session_cameras sc ON sc.session_id=s.id
    WHERE s.user_id=${user.id} AND sc.camera_device_id=${deviceId}::uuid AND s.status='active'
    ORDER BY s.created_at DESC LIMIT 1`;
  return NextResponse.json(rows[0] || null);
}
