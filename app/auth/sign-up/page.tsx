"use client";

import Link from 'next/link';
import { useActionState } from 'react';
import { signUp } from './actions';

export default function SignUpPage() {
  const [state, action, pending] = useActionState(signUp, null);
  return (
    <main className="auth-shell">
      <section className="auth-card glass">
        <div className="brand-mark">◎</div>
        <p className="eyebrow">ANYPHOTO</p>
        <h1>Crie sua central de câmeras.</h1>
        <p className="muted">Use a mesma conta em todos os aparelhos.</p>
        <form action={action} className="stack">
          <label>Nome<input name="name" autoComplete="name" required /></label>
          <label>E-mail<input name="email" type="email" autoComplete="email" required /></label>
          <label>Senha<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
          {state?.error && <p className="error">{state.error}</p>}
          <button className="button primary" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</button>
        </form>
        <p className="auth-foot">Já tem conta? <Link href="/auth/sign-in">Entrar</Link></p>
      </section>
    </main>
  );
}
