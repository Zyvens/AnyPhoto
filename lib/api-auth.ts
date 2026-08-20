import { getAuth } from '@/lib/auth/server';

export async function currentUser() {
  const { data: session } = await getAuth().getSession();
  return session?.user ?? null;
}
