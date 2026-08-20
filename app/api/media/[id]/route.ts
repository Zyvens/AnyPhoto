import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/api-auth';
import { db } from '@/lib/db';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json();
  const status = ['source_only','transferred','cloud'].includes(body.transferStatus) ? body.transferStatus : 'source_only';
  const sql = db();
  await sql`UPDATE public.media_items SET transfer_status=${status}, original_retained=${body.originalRetained !== false} WHERE id=${id}::uuid AND user_id=${user.id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const sql = db();
  await sql`UPDATE public.media_items SET deleted_at=now() WHERE id=${id}::uuid AND user_id=${user.id}`;
  return NextResponse.json({ ok: true });
}
