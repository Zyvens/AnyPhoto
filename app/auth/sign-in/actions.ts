"use server";

import { getAuth } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

export async function signIn(_: { error?: string } | null, formData: FormData) {
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  try {
    const { error } = await getAuth().signIn.email({ email, password });
    if (error) return { error: error.message || 'Não foi possível entrar.' };
  } catch (error) {
    console.error('AnyPhoto auth configuration error', error);
    return {
      error:
        'O login seguro ainda não está conectado ao ambiente de produção. A aplicação está online, mas a autenticação precisa da conexão Vercel ↔ Neon.',
    };
  }

  redirect('/');
}
