"use client";

import Link from 'next/link';
import { useActionState } from 'react';
import { signIn } from './actions';

export default function SignInPage() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="auth-shell">
      <section className="auth-card glass">
        <div className="brand-mark">◎</div>
        <p className="eyebrow">ANYPHOTO</p>
        <h1>Entre no seu estúdio remoto.</h1>
        <p className="muted">O mesmo login conecta controle, câmeras e galeria.</p>
        <form action={action} className="stack">
          <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="current-password" required /></label>
          {state?.error && <p className="error">{state.error}</p>}
          <button className="button primary" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
        </form>
        <p className="auth-foot">Primeiro acesso? <Link href="/auth/sign-up">Criar conta</Link></p>
      </section>
    </main>
  );
}
