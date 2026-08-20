import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sql = db();
  const rows = await sql`
    SELECT m.id, m.session_id, m.source_device_id, d.name AS source_name, m.kind, m.filename, m.mime_type,
      m.byte_size, m.duration_ms, m.width, m.height, m.local_object_key, m.thumbnail_data_url, m.cloud_url,
      m.transfer_status, m.original_retained, m.created_at
    FROM public.media_items m JOIN public.devices d ON d.id=m.source_device_id
    WHERE m.user_id=${user.id} AND m.deleted_at IS NULL
    ORDER BY m.created_at DESC LIMIT 300`;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await request.json();
  const sql = db();
  const [device] = await sql`SELECT id FROM public.devices WHERE id=${String(body.sourceDeviceId)}::uuid AND user_id=${user.id}`;
  if (!device) return NextResponse.json({ error: 'invalid source device' }, { status: 400 });
  const rows = await sql`
    INSERT INTO public.media_items (id, user_id, session_id, source_device_id, kind, filename, mime_type, byte_size, duration_ms, width, height, local_object_key, thumbnail_data_url)
    VALUES (${String(body.id)}::uuid, ${user.id}, ${body.sessionId ? String(body.sessionId) : null}::uuid, ${String(body.sourceDeviceId)}::uuid,
      ${body.kind === 'video' ? 'video' : 'photo'}, ${String(body.filename).slice(0,160)}, ${String(body.mimeType).slice(0,120)}, ${Number(body.byteSize)||0},
      ${body.durationMs == null ? null : Number(body.durationMs)}, ${body.width == null ? null : Number(body.width)}, ${body.height == null ? null : Number(body.height)},
      ${String(body.localObjectKey || '').slice(0,200)}, ${body.thumbnailDataUrl ? String(body.thumbnailDataUrl) : null})
    ON CONFLICT (id) DO NOTHING RETURNING id`;
  return NextResponse.json(rows[0] || { id: body.id }, { status: 201 });
}
