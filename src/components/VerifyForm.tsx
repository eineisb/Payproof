import { useState } from 'react';
import { Search, AlertCircle, X } from 'lucide-react';
import { ARC_MAINNET_CHAIN_ID } from '@/lib/verify';

export interface FormValues {
  txHash: string;
  claimedAmount: string;
  expectedRecipient: string;
  chainId: number;
}

interface Props {
  onSubmit: (values: FormValues) => void;
  loading: boolean;
  onCancel?: (values: FormValues) => void;
  initialValues?: FormValues | null;
}

export function VerifyForm({ onSubmit, loading, onCancel, initialValues }: Props) {
  const [txHash, setTxHash] = useState(initialValues?.txHash ?? '');
  const [claimedAmount, setClaimedAmount] = useState(initialValues?.claimedAmount ?? '');
  const [expectedRecipient, setExpectedRecipient] = useState(initialValues?.expectedRecipient ?? '');
  const chainId = ARC_MAINNET_CHAIN_ID;
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});

  function validate(): boolean {
    const next: typeof errors = {};
    if (!txHash.trim()) next.txHash = 'Transaction hash is required.';
    else if (!/^0x[0-9a-fA-F]{64}$/.test(txHash.trim()))
      next.txHash = 'Must be a 0x-prefixed 64-character hex string.';
    if (!claimedAmount.trim()) next.claimedAmount = 'Claimed amount is required.';
    else if (isNaN(parseFloat(claimedAmount)) || parseFloat(claimedAmount) <= 0)
      next.claimedAmount = 'Must be a positive number, e.g. 10.50';
    if (!expectedRecipient.trim()) next.expectedRecipient = 'Recipient address is required.';
    else if (!/^0x[0-9a-fA-F]{40}$/.test(expectedRecipient.trim()))
      next.expectedRecipient = 'Must be a valid 0x Ethereum address (42 characters).';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSubmit({
      txHash: txHash.trim(),
      claimedAmount: claimedAmount.trim(),
      expectedRecipient: expectedRecipient.trim(),
      chainId,
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="space-y-5">
        {/* Transaction hash */}
        <Field
          id="txHash"
          label="Transaction Hash"
          placeholder="0x..."
          value={txHash}
          onChange={setTxHash}
          error={errors.txHash}
          mono
          hint="The hash the payer provided as proof of payment."
        />

        {/* Expected amount */}
        <Field
          id="claimedAmount"
          label="Claimed Amount (USDC)"
          placeholder="e.g. 50.00"
          value={claimedAmount}
          onChange={setClaimedAmount}
          error={errors.claimedAmount}
          inputMode="decimal"
          hint="The USDC amount the payer claims to have sent."
        />

        {/* Recipient address */}
        <Field
          id="expectedRecipient"
          label="Expected Recipient Address"
          placeholder="0x..."
          value={expectedRecipient}
          onChange={setExpectedRecipient}
          error={errors.expectedRecipient}
          mono
          hint="The wallet address that should have received the payment."
        />

        {/* Submit, or Cancel while a check is running */}
        {loading ? (
          <button
            type="button"
            onClick={() =>
              onCancel?.({
                txHash: txHash.trim(),
                claimedAmount: claimedAmount.trim(),
                expectedRecipient: expectedRecipient.trim(),
                chainId,
              })
            }
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-150 focus:outline-none focus:ring-2"
            style={{
              background: 'var(--surface-strong)',
              color: 'var(--ink)',
              border: '1px solid var(--border-strong)',
              minHeight: '48px',
            }}
          >
            <span
              className="inline-block w-4 h-4 border-2 rounded-full animate-spin"
              style={{ borderColor: 'var(--border-strong)', borderTopColor: 'var(--accent)' }}
            />
            <X size={16} />
            Cancel
          </button>
        ) : (
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl font-semibold text-sm transition-all duration-150 focus:outline-none focus:ring-2"
            style={{
              background: 'var(--accent)',
              color: '#0b1628',
              minHeight: '48px',
            }}
          >
            <Search size={16} />
            Verify Payment
          </button>
        )}
      </div>
    </form>
  );
}

interface FieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  mono?: boolean;
  hint?: string;
  inputMode?: React.InputHTMLAttributes<HTMLInputElement>['inputMode'];
}

function Field({ id, label, placeholder, value, onChange, error, mono, hint, inputMode }: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-semibold tracking-widest uppercase mb-1.5"
        style={{ color: 'var(--muted)', letterSpacing: '0.08em' }}
      >
        {label}
      </label>
      <input
        id={id}
        type="text"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        className="w-full py-3 px-4 rounded-xl text-sm transition-all duration-150 focus:outline-none focus:ring-2 placeholder:opacity-40"
        style={{
          background: 'var(--surface-muted)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          color: 'var(--ink)',
          fontFamily: mono ? "'JetBrains Mono', Menlo, monospace" : "'DM Sans', sans-serif",
          fontSize: mono ? '0.8125rem' : '0.875rem',
        }}
      />
      {hint && !error && (
        <p className="text-xs mt-1.5" style={{ color: 'var(--subtle)' }}>
          {hint}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-xs mt-1.5" style={{ color: 'var(--danger)' }}>
          <AlertCircle size={12} />
          {error}
        </p>
      )}
    </div>
  );
}
