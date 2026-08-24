"use server";

import { getAuth } from '@/lib/auth/server';
import { redirect } from 'next/navigation';

type AuthErrorLike = {
  code?: string;
  status?: number;
  message?: string;
};

export async function signUp(_: { error?: string } | null, formData: FormData) {
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim();
  const password = String(formData.get('password') || '');

  if (!name) return { error: 'Informe seu nome.' };
  if (!email) return { error: 'Informe seu e-mail.' };
  if (password.length < 8) return { error: 'Use uma senha com pelo menos 8 caracteres.' };

  try {
    const { error } = await getAuth().signUp.email({ name, email, password });

    if (error) {
      const authError = error as AuthErrorLike;
      console.error('AnyPhoto sign-up rejected by Neon Auth', {
        code: authError.code || 'UNKNOWN',
        status: authError.status || null,
        message: authError.message || 'Unknown auth error',
      });

      const code = String(authError.code || '').toUpperCase();
      const message = String(authError.message || '');

      if (code.includes('ORIGIN') || /origin/i.test(message)) {
        return { error: 'O domínio do AnyPhoto ainda não está autorizado no Neon Auth. Tente novamente em alguns instantes.' };
      }

      if (code.includes('USER_ALREADY_EXISTS') || /already exists|already registered/i.test(message)) {
        return { error: 'Já existe uma conta com esse e-mail. Use a opção Entrar.' };
      }

      if (code.includes('PASSWORD') || /password/i.test(message)) {
        return { error: 'A senha não atende aos requisitos de segurança. Use pelo menos 8 caracteres.' };
      }

      return { error: authError.message || 'Não foi possível criar sua conta.' };
    }
  } catch (error) {
    console.error('AnyPhoto auth configuration error', error);
    return {
      error:
        'Não foi possível conectar o cadastro ao Neon Auth. A configuração já está sendo validada no servidor.',
    };
  }

  redirect('/');
}
