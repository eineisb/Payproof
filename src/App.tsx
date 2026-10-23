import { useState, useRef, useEffect } from 'react';
import { ShieldCheck, Info, AlertTriangle } from 'lucide-react';
import { verifyPayment, type VerificationResult } from '@/lib/verify';
import { buildShareUrl, readShareParams } from '@/lib/share';
import { VerifyForm, type FormValues } from '@/components/VerifyForm';
import { ResultPanel } from '@/components/ResultPanel';
import { ReportModal } from '@/components/ReportModal';

type Phase = 'form' | 'result';

const DRAFT_KEY = 'payproof-draft';

export default function App() {
  // Inputs from a shared link, if the page was opened with one.
  const [seed, setSeed] = useState<FormValues | null>(() => readShareParams());
  // Inputs saved just before a cancel-triggered reload. Read once, then cleared.
  const [draft] = useState<FormValues | null>(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      sessionStorage.removeItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as FormValues) : null;
    } catch {
      return null;
    }
  });
  const [phase, setPhase] = useState<Phase>('form');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [lastInput, setLastInput] = useState<FormValues | null>(null);
  const [repeatCount, setRepeatCount] = useState(1);
  const [showReport, setShowReport] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  // Session record: how many times each (network, hash) was checked in this tab.
  // In memory only, so it resets when the tab is closed or reloaded.
  const sessionChecks = useRef<Map<string, number>>(new Map());
  const autoRan = useRef(false);
  // Each check gets a number. Cancelling bumps the number, so a late result is ignored.
  const requestId = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  function handleCancel(values: FormValues) {
    // Reloading the page is the one reliable way to stop every request in progress.
    // The inputs are saved first, so the form comes back filled in.
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(values));
    window.history.replaceState(null, '', window.location.pathname);
    window.location.reload();
  }

  async function handleVerify(values: FormValues) {
    const key = `${values.chainId}:${values.txHash.toLowerCase()}`;
    const count = (sessionChecks.current.get(key) ?? 0) + 1;
    sessionChecks.current.set(key, count);

    setRepeatCount(count);
    setLastInput(values);
    const id = ++requestId.current;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    // Keep the address bar in sync, so the page URL is always a working share link.
    window.history.replaceState(null, '', buildShareUrl(values));

    try {
      const res = await verifyPayment({ ...values, signal: controller.signal });
      if (id !== requestId.current) return;
      setResult(res);
      setPhase('result');
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 50);
    } catch (err) {
      if (id !== requestId.current) return;
      const message = err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.';
      setResult({
        outcome: 'UNVERIFIABLE',
        txHash: values.txHash,
        network: 'Arc',
        chainId: values.chainId,
        fields: [],
        explorerUrl: `https://explorer.arc.io/tx/${values.txHash}`,
        usdcContractAddress: '0x3600000000000000000000000000000000000000',
        timestamp: new Date().toISOString(),
        errorDetail: message,
      });
      setPhase('result');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  // Auto-run once when opened from a shared link. The ref guards against
  // React StrictMode running effects twice in development.
  useEffect(() => {
    if (autoRan.current || !seed) return;
    autoRan.current = true;
    void handleVerify(seed);
  }, [seed]);

  function handleReset() {
    setPhase('form');
    setResult(null);
    setLastInput(null);
    setSeed(null);
    window.history.replaceState(null, '', window.location.pathname);
  }

  const shareUrl = lastInput ? buildShareUrl(lastInput) : window.location.href;

  return (
    <div
      className="min-h-dvh flex flex-col items-center justify-start px-4 py-10"
      style={{ background: 'var(--bg)', backgroundImage: 'var(--bg-gradient)' }}
    >
      <div className="w-full max-w-md">
        {/* Header */}
        <header className="text-center mb-8">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'var(--surface-strong)', border: '1px solid var(--border-strong)' }}
            >
              <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
            </div>
            <h1 className="display font-bold text-2xl" style={{ color: 'var(--ink)' }}>
              PayProof
            </h1>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
            Don't trust the screenshot.{' '}
            <span style={{ color: 'var(--ink-2)' }}>Verify the payment.</span>
          </p>
        </header>

        {/* Main card */}
        <div
          ref={resultRef}
          className="rounded-2xl p-6"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {phase === 'form' ? (
            <VerifyForm
              onSubmit={(v) => { void handleVerify(v); }}
              loading={loading}
              onCancel={handleCancel}
              initialValues={seed ?? draft}
            />
          ) : result ? (
            <>
              {repeatCount > 1 && (
                <div
                  className="mb-4 rounded-xl p-3 flex gap-2 text-xs leading-relaxed"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-strong)', color: 'var(--ink-2)' }}
                >
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                  <span>
                    This transaction has been checked {repeatCount} times in this tab.
                    Repeat checks are normal, but compare each claim carefully against the first one.
                  </span>
                </div>
              )}
              <ResultPanel
                result={result}
                onGenerateReport={() => setShowReport(true)}
                onReset={handleReset}
              />
            </>
          ) : null}
        </div>

        {/* What PayProof checks */}
        {phase === 'form' && (
          <div
            className="mt-5 rounded-2xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Info size={14} style={{ color: 'var(--muted)' }} />
              <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
                What PayProof checks
              </span>
            </div>
            <ul className="space-y-2">
              {[
                'Transaction exists and succeeded on Arc',
                'The transfer was made in USDC (not another token)',
                'The USDC went to the expected recipient',
                'The transferred amount matches the claimed amount',
                'No wallet connection or signing required',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2 text-xs" style={{ color: 'var(--ink-2)' }}>
                  <span className="mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)', marginTop: '0.4rem' }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Disclaimer */}
        <p className="text-center text-xs mt-6 leading-relaxed" style={{ color: 'var(--subtle)' }}>
          Read-only. Verifies on-chain data only.{' '}
          Does not verify the identity of any party.
        </p>
      </div>

      {/* Report modal */}
      {showReport && result && (
        <ReportModal
          result={result}
          shareUrl={shareUrl}
          repeatCount={repeatCount}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
