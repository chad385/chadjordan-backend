'use client';

import { useEffect, useState } from 'react';

export default function UnsubscribePage() {
  const [token, setToken] = useState('');
  const [state, setState] = useState<'ready' | 'working' | 'done' | 'invalid' | 'error'>('ready');

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get('t') || '';
    setToken(value);
    if (!value) setState('invalid');
  }, []);

  const submit = async () => {
    setState('working');
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean };
      setState(res.ok && data.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-minimal-bg px-6">
      <div className="w-full max-w-md border border-minimal-border rounded-lg p-8">
        <h1 className="text-base font-semibold text-white">Unsubscribe</h1>
        {state === 'done' ? (
          <p className="mt-4 text-sm text-zinc-300 leading-relaxed">
            You are unsubscribed. Chad Jordan Studio will not email this address again.
          </p>
        ) : state === 'invalid' ? (
          <p className="mt-4 text-sm text-zinc-300 leading-relaxed">This unsubscribe link is incomplete.</p>
        ) : (
          <>
            <p className="mt-4 text-sm text-zinc-300 leading-relaxed">
              This stops lead emails from Chad Jordan Studio to the address on this link.
            </p>
            {state === 'error' && (
              <p className="mt-3 text-sm text-red-400">That link could not be confirmed. Try it once more.</p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={state === 'working' || !token}
              className="mt-6 w-full py-2.5 bg-white text-black text-[14px] font-semibold rounded-lg disabled:opacity-30"
            >
              {state === 'working' ? 'Working…' : 'Unsubscribe'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
