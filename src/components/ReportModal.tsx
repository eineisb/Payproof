import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X, Download, CheckCircle, AlertTriangle, ShieldAlert, HelpCircle } from 'lucide-react';
import type { VerificationResult, FieldResult } from '@/lib/verify';
import { chainTime, downloadReceipt, downloadReceiptPng, receiptStatus } from '@/lib/receipt';
import type { StatusKind } from '@/lib/receipt';

interface Props {
  result: VerificationResult;
  shareUrl: string;
  repeatCount: number;
  onClose: () => void;
}

const INK = '#1b2538';
const MUTED = '#6b7280';
const RULE = '#e2e7f0';
const NAVY = '#1b3158';

function StatusIcon({ kind, color }: { kind: StatusKind; color: string }) {
  const size = 30;
  if (kind === 'verified') return <CheckCircle size={size} style={{ color }} />;
  if (kind === 'failed') return <AlertTriangle size={size} style={{ color }} />;
  if (kind === 'mismatch') return <ShieldAlert size={size} style={{ color }} />;
  return <HelpCircle size={size} style={{ color }} />;
}

function Row({ name, value, mono }: { name: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-x-4 py-1" style={{ gridTemplateColumns: 'max-content 1fr' }}>
      <span style={{ color: MUTED }}>{name}</span>
      <span
        style={{
          wordBreak: 'break-all',
          fontFamily: mono ? "'JetBrains Mono', Menlo, monospace" : undefined,
          fontSize: mono ? '12px' : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return (
    <h3
      className="mt-5 mb-2 pb-1 font-bold uppercase"
      style={{ fontSize: '11px', letterSpacing: '0.08em', color: NAVY, borderBottom: `1px solid ${RULE}` }}
    >
      {title}
    </h3>
  );
}

export function ReportModal({ result, shareUrl, repeatCount, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [savedAs, setSavedAs] = useState<'pdf' | 'png' | null>(null);
  const status = receiptStatus(result);
  const issued = new Date(result.timestamp);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function markSaved(kind: 'pdf' | 'png') {
    setSavedAs(kind);
    setTimeout(() => setSavedAs(null), 1500);
  }

  function handleDownloadPdf() {
    downloadReceipt(result, shareUrl, repeatCount);
    markSaved('pdf');
  }

  async function handleDownloadPng() {
    await downloadReceiptPng(result, shareUrl, repeatCount);
    markSaved('png');
  }

  return (
    <div
      ref={overlayRef}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Verification receipt"
    >
      <div
        className="w-full max-w-lg rounded-2xl flex flex-col max-h-[88vh]"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border-strong)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
            Verification Receipt
          </span>
          <button
            onClick={onClose}
            className="opacity-60 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 rounded p-1"
            aria-label="Close"
          >
            <X size={18} style={{ color: 'var(--ink)' }} />
          </button>
        </div>

        {/* Receipt preview */}
        <div className="overflow-auto flex-1 p-4">
          <article className="rounded-xl p-5" style={{ background: '#ffffff', color: INK, fontSize: '13px', lineHeight: 1.5 }}>
            <div className="rounded-lg px-4 py-3 mb-4" style={{ background: NAVY, color: '#ffffff' }}>
              <div className="font-bold text-base">PayProof</div>
              <div className="text-xs" style={{ color: '#acc6e9' }}>Verification receipt</div>
            </div>

            {/* Status card */}
            <div className="flex items-start gap-3 mb-4">
              <div className="shrink-0 mt-0.5">
                <StatusIcon kind={status.kind} color={status.hex} />
              </div>
              <div>
                <div className="font-bold text-lg" style={{ color: INK }}>
                  {status.title}
                </div>
                {status.subtitle && (
                  <div className="font-semibold text-sm" style={{ color: status.hex }}>
                    {status.subtitle}
                  </div>
                )}
                <p className="mt-2 text-sm" style={{ color: INK }}>
                  {status.description}
                </p>
              </div>
            </div>

            <Row name="Issued" value={issued.toUTCString()} />
            <Row name="Network" value={`${result.network} (Chain ID ${result.chainId})`} />
            <Row name="Token" value={`USDC, contract ${result.usdcContractAddress}`} mono />
            <Row name="Checks this session" value={String(repeatCount)} />

            <Section title="Transaction" />
            <Row name="Hash" value={result.txHash} mono />
            {result.blockNumber !== undefined && <Row name="Block" value={result.blockNumber.toString()} mono />}
            <Row name="Transaction time" value={chainTime(result.blockTime)} />
            <Row
              name="Explorer"
              value={
                <a href={result.explorerUrl} target="_blank" rel="noopener noreferrer" style={{ color: NAVY }}>
                  {result.explorerUrl}
                </a>
              }
              mono
            />

            <Section title="Claim vs. chain" />
            {result.fields.length === 0 ? (
              <p style={{ color: MUTED }}>No field comparison is available for this outcome.</p>
            ) : (
              <table className="w-full" style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead>
                  <tr>
                    {['Field', 'Claimed', 'On-chain', 'Result'].map((h) => (
                      <th
                        key={h}
                        className="text-left py-2 px-1"
                        style={{ color: MUTED, fontSize: '10px', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: `1px solid ${RULE}` }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.fields.map((f: FieldResult) => {
                    const tone = f.match === true ? '#15803d' : f.match === false ? '#b45309' : '#9ca3af';
                    const text = f.match === true ? 'Match' : f.match === false ? 'No match' : 'n/a';
                    return (
                      <tr key={f.label}>
                        <td className="py-2 px-1 align-top" style={{ borderBottom: `1px solid ${RULE}`, color: MUTED }}>{f.label}</td>
                        <td className="py-2 px-1 align-top" style={{ borderBottom: `1px solid ${RULE}`, wordBreak: 'break-all' }}>{f.claimed}</td>
                        <td className="py-2 px-1 align-top" style={{ borderBottom: `1px solid ${RULE}`, wordBreak: 'break-all' }}>{f.actual}</td>
                        <td className="py-2 px-1 align-top font-semibold" style={{ borderBottom: `1px solid ${RULE}`, color: tone }}>{text}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {result.errorDetail && (
              <>
                <Section title="Notes" />
                <p>{result.errorDetail}</p>
              </>
            )}

            <Section title="Re-run this check" />
            <a href={shareUrl} style={{ color: NAVY, wordBreak: 'break-all', fontSize: '12px' }}>
              {shareUrl}
            </a>

            <div className="mt-5 rounded-lg p-3 text-xs" style={{ background: '#f3f5f9', color: '#4b5563' }}>
              This receipt verifies specific on-chain transaction details only. It does not verify the
              identity or honesty of any party who submitted the payment.
            </div>
          </article>
        </div>

        {/* Actions */}
        <div className="flex gap-2 p-4" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleDownloadPdf}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2"
            style={{
              background: savedAs === 'pdf' ? 'var(--success-dim)' : 'var(--accent)',
              color: savedAs === 'pdf' ? 'var(--success)' : '#0b1628',
            }}
          >
            <Download size={15} />
            {savedAs === 'pdf' ? 'Saved PDF' : 'PDF'}
          </button>
          <button
            onClick={handleDownloadPng}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all duration-150 focus:outline-none focus:ring-2"
            style={{
              background: savedAs === 'png' ? 'var(--success-dim)' : 'var(--accent)',
              color: savedAs === 'png' ? 'var(--success)' : '#0b1628',
            }}
          >
            <Download size={15} />
            {savedAs === 'png' ? 'Saved image' : 'Image'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl text-sm font-medium focus:outline-none focus:ring-2"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
