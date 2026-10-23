import { CheckCircle, XCircle, Clock, HelpCircle, ExternalLink, Copy, FileText, AlertTriangle } from 'lucide-react';
import type { VerificationResult, VerificationOutcome } from '@/lib/verify';

interface Props {
  result: VerificationResult;
  onGenerateReport: () => void;
  onReset: () => void;
}

const OUTCOME_CONFIG: Record<
  VerificationOutcome,
  { label: string; sublabel: string; icon: React.ReactNode; color: string; dimColor: string; borderColor: string }
> = {
  MATCH: {
    label: 'MATCH',
    sublabel: 'All payment details verified on-chain.',
    icon: <CheckCircle size={28} />,
    color: 'var(--success)',
    dimColor: 'var(--success-dim)',
    borderColor: 'rgba(34, 197, 94, 0.30)',
  },
  MISMATCH: {
    label: 'MISMATCH',
    sublabel: 'One or more payment details do not match.',
    icon: <XCircle size={28} />,
    color: 'var(--danger)',
    dimColor: 'var(--danger-dim)',
    borderColor: 'rgba(244, 63, 94, 0.30)',
  },
  FAILED_OR_PENDING: {
    label: 'FAILED / PENDING',
    sublabel: 'Transaction did not succeed or was not yet found.',
    icon: <Clock size={28} />,
    color: 'var(--warning)',
    dimColor: 'var(--warning-dim)',
    borderColor: 'rgba(245, 158, 11, 0.30)',
  },
  UNVERIFIABLE: {
    label: 'UNVERIFIABLE',
    sublabel: 'Not enough data to confirm or deny the payment.',
    icon: <HelpCircle size={28} />,
    color: 'var(--unverifiable)',
    dimColor: 'var(--unverifiable-dim)',
    borderColor: 'rgba(148, 163, 184, 0.25)',
  },
};

export function ResultPanel({ result, onGenerateReport, onReset }: Props) {
  const cfg = OUTCOME_CONFIG[result.outcome];

  function copyHash() {
    navigator.clipboard.writeText(result.txHash).catch(() => {});
  }

  return (
    <div className="space-y-4">
      {/* Outcome badge */}
      <div
        className="rounded-2xl p-5 flex items-start gap-4"
        style={{
          background: cfg.dimColor,
          border: `1.5px solid ${cfg.borderColor}`,
        }}
      >
        <span style={{ color: cfg.color, flexShrink: 0, marginTop: 2 }}>{cfg.icon}</span>
        <div>
          <p
            className="display font-bold text-xl tracking-tight"
            style={{ color: cfg.color }}
          >
            {cfg.label}
          </p>
          <p className="text-sm mt-0.5" style={{ color: 'var(--ink-2)' }}>
            {cfg.sublabel}
          </p>
        </div>
      </div>

      {/* Error / advisory detail */}
      {result.errorDetail && (
        <div
          className="rounded-xl p-4 flex gap-3"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
            {result.errorDetail}
          </p>
        </div>
      )}

      {/* Field comparison table */}
      {result.fields.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ background: 'var(--surface-strong)', borderBottom: '1px solid var(--border)' }}
          >
            <span className="text-xs font-semibold tracking-widest uppercase" style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}>
              Claim vs. Chain
            </span>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {result.fields.map((field, i) => (
              <FieldRow key={i} field={field} />
            ))}
          </div>
        </div>
      )}

      {/* Transaction metadata */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <MetaRow label="Network" value={result.network} />
        <MetaRow
          label="Transaction Hash"
          value={truncate(result.txHash, 12)}
          mono
          action={
            <button
              onClick={copyHash}
              className="ml-2 opacity-60 hover:opacity-100 transition-opacity focus:outline-none"
              aria-label="Copy transaction hash"
            >
              <Copy size={13} />
            </button>
          }
        />
        {result.blockNumber !== undefined && (
          <MetaRow label="Block" value={result.blockNumber.toString()} mono />
        )}
        <MetaRow label="USDC Contract" value={truncate(result.usdcContractAddress, 10)} mono />
        <MetaRow label="Verified at" value={new Date(result.timestamp).toLocaleString()} />
        {result.multipleTransfersDetected && (
          <div className="pt-1">
            <p className="text-xs" style={{ color: 'var(--warning)' }}>
              Multiple USDC transfers detected in this transaction. Only the relevant transfer is shown above.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <a
          href={result.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--ink-2)',
            textDecoration: 'none',
          }}
        >
          <ExternalLink size={14} />
          View on Explorer
        </a>
        <button
          onClick={onGenerateReport}
          className="flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-medium transition-all duration-150 focus:outline-none focus:ring-2"
          style={{
            background: 'var(--surface-strong)',
            border: '1px solid var(--border-strong)',
            color: 'var(--ink)',
          }}
        >
          <FileText size={14} />
          View Receipt
        </button>
      </div>

      <button
        onClick={onReset}
        className="w-full py-2 text-sm font-medium transition-opacity opacity-60 hover:opacity-100 focus:outline-none"
        style={{ color: 'var(--muted)' }}
      >
        Verify another payment
      </button>
    </div>
  );
}

// Field row
import type { FieldResult } from '@/lib/verify';

function FieldRow({ field }: { field: FieldResult }) {
  const matchColor =
    field.match === true ? 'var(--success)' : field.match === false ? 'var(--danger)' : 'var(--subtle)';

  return (
    <div className="px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--muted)', letterSpacing: '0.06em' }}>
          {field.label.toUpperCase()}
        </span>
        {field.match !== null && (
          <span className="text-xs font-semibold" style={{ color: matchColor }}>
            {field.match ? 'MATCH' : 'MISMATCH'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>
            Claimed
          </p>
          <p className="text-sm mono break-all tabular-nums" style={{ color: 'var(--ink-2)' }}>
            {field.claimed}
          </p>
        </div>
        <div>
          <p className="text-xs mb-1" style={{ color: 'var(--subtle)' }}>
            On-chain
          </p>
          <p
            className="text-sm mono break-all tabular-nums"
            style={{ color: field.match === false ? 'var(--danger)' : 'var(--ink)' }}
          >
            {field.actual}
          </p>
        </div>
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: string;
  mono?: boolean;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <span
        className={`text-xs text-right break-all tabular-nums flex items-center ${mono ? 'mono' : ''}`}
        style={{ color: 'var(--ink-2)' }}
      >
        {value}
        {action}
      </span>
    </div>
  );
}

function truncate(str: string, chars: number): string {
  if (str.length <= chars * 2 + 3) return str;
  return str.slice(0, chars) + '...' + str.slice(-6);
}
