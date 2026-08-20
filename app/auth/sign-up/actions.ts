"use server";

import { getAuth } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

export async function signUp(_: { error?: string } | null, formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');
  if (password.length < 8) return { error: 'Use uma senha com pelo menos 8 caracteres.' };
  const { error } = await getAuth().signUp.email({ name, email, password });
  if (error) return { error: error.message || 'Não foi possível criar sua conta.' };
  redirect('/');
}
