import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/server';
import AnyPhotoApp from '@/components/anyphoto-app';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const authConfigured = Boolean(
    process.env.NEON_AUTH_COOKIE_SECRET || process.env.DATABASE_URL,
  );

  if (!authConfigured) redirect('/auth/sign-in?setup=1');

  const { data: session } = await getAuth().getSession();
  if (!session?.user) redirect('/auth/sign-in');
  return <AnyPhotoApp userName={session.user.name || session.user.email || 'Usuário'} />;
}
