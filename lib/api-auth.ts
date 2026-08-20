import { auth } from '@/lib/auth/server';

export async function currentUser() {
  const { data: session } = await auth.getSession();
  return session?.user ?? null;
}
