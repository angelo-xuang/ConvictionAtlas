'use client';

import { useState } from 'react';
import { fetchApi, postApi } from '../lib/api';
import type { MemoUnlockResult } from '../lib/types';

type PaymentInfo = {
  network: string;
  networkCode?: string;
  wallet: string;
  token: string;
  contract: string;
  minAmount: number;
  memo: string;
  explorerUrl: string;
  faucetUrl?: string | null;
};

type UnlockStep = 'idle' | 'showing-payment' | 'submitting-tx' | 'done' | 'error';

export function MemoUnlockButton({ memoId }: { memoId: string }) {
  const [step, setStep] = useState<UnlockStep>('idle');
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [txHash, setTxHash] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  async function handleGetPaymentInfo() {
    setStep('showing-payment');
    setMessage(null);
    try {
      const info = await fetchApi<PaymentInfo>(`/memos/${memoId}/payment-info`);
      setPaymentInfo(info);
    } catch {
      setMessage('无法加载支付信息，请确认 API 正在运行。');
      setStep('error');
    }
  }

  async function handleSubmitTx() {
    if (!txHash.trim()) {
      setMessage('请输入交易哈希。');
      return;
    }
    setStep('submitting-tx');
    setMessage(null);

    try {
      const response = await postApi<MemoUnlockResult>(`/memos/${memoId}/unlock`, {
        customerRef: 'tron-user',
        txHash: txHash.trim(),
      });
      setIsSuccess(response.success ?? false);
      setMessage(response.message ?? '完成。');
      if (response.success) setStep('done');
      else setStep('error');
    } catch (error) {
      setIsSuccess(false);
      setMessage(error instanceof Error ? error.message : '验证失败。');
      setStep('error');
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  if (step === 'done') {
    return (
      <div className="unlock-success">
        <span className="unlock-check">✅</span>
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="unlock-shell">
      {step === 'idle' && (
        <button type="button" className="button-link unlock-trigger" onClick={handleGetPaymentInfo}>
          🔓 通过 TRON USDT 解锁完整备忘录
        </button>
      )}

      {(step === 'showing-payment' || step === 'submitting-tx' || step === 'error') && paymentInfo && (
        <div className="unlock-panel">
          <div className="unlock-header">
            <span className="unlock-badge">{paymentInfo.network}</span>
            <span className="unlock-amount">{paymentInfo.minAmount} USDT</span>
          </div>

          <div className="unlock-wallet-row">
            <span className="unlock-label">发送至:</span>
            <code className="unlock-address">{paymentInfo.wallet}</code>
            <button
              type="button"
              className="unlock-copy"
              onClick={() => copyToClipboard(paymentInfo.wallet)}
              title="复制地址"
            >
              📋
            </button>
          </div>

          <div className="unlock-wallet-row">
            <span className="unlock-label">代币:</span>
            <span className="unlock-value">{paymentInfo.token}</span>
          </div>

          <div className="unlock-wallet-row">
            <span className="unlock-label">备注:</span>
            <code className="unlock-address">{paymentInfo.memo}</code>
          </div>

          <div className="unlock-links">
            <a href={paymentInfo.explorerUrl} target="_blank" rel="noreferrer" className="unlock-link">
              在浏览器中查看 ↗
            </a>
            {paymentInfo.faucetUrl ? (
              <a href={paymentInfo.faucetUrl} target="_blank" rel="noreferrer" className="unlock-link">
                获取测试币 ↗
              </a>
            ) : null}
          </div>

          <div className="unlock-divider" />

          <div className="unlock-tx-row">
            <input
              type="text"
              className="unlock-tx-input"
              placeholder="发送后粘贴交易哈希..."
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              disabled={step === 'submitting-tx'}
            />
            <button
              type="button"
              className="unlock-verify-btn"
              onClick={handleSubmitTx}
              disabled={step === 'submitting-tx' || !txHash.trim()}
            >
              {step === 'submitting-tx' ? '验证中...' : '验证并解锁'}
            </button>
          </div>

          {message && (
            <div className={`unlock-feedback ${isSuccess ? 'success' : 'error'}`}>
              {message}
            </div>
          )}
        </div>
      )}

      {step === 'showing-payment' && !paymentInfo && (
        <div className="muted">正在加载支付信息...</div>
      )}
    </div>
  );
}
