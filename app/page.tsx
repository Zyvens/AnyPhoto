import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/server';
import AnyPhotoApp from '@/components/anyphoto-app';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect('/auth/sign-in');
  return <AnyPhotoApp userName={session.user.name || session.user.email || 'Usuário'} />;
}
