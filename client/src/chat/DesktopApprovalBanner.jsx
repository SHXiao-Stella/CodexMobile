import { Check, Terminal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { desktopApprovalErrorView, desktopApprovalView } from '../desktop-approval-display.js';

export function DesktopApprovalBanner({ approvals = [], onDecision }) {
  const pending = useMemo(
    () => (Array.isArray(approvals) ? approvals.filter((approval) => approval?.actionable !== false) : []),
    [approvals]
  );
  const approval = pending[0] || null;
  const [busyDecision, setBusyDecision] = useState('');
  const [error, setError] = useState('');

  if (!approval) {
    return null;
  }

  const extraCount = Math.max(0, pending.length - 1);
  const busy = Boolean(busyDecision);
  const view = desktopApprovalView(approval);

  async function submit(decision) {
    setBusyDecision(decision);
    setError('');
    try {
      await onDecision?.(approval, decision);
    } catch (submitError) {
      setError(desktopApprovalErrorView(submitError).inline || submitError.message || '审批发送失败，请重试。');
    } finally {
      setBusyDecision('');
    }
  }

  return (
    <section className="desktop-approval-banner" aria-live="polite">
      <div className="desktop-approval-icon">
        <Terminal size={18} />
      </div>
      <div className="desktop-approval-body">
        <div className="desktop-approval-title">
          <span>{view.title}</span>
          {extraCount ? <small>另有 {extraCount} 条待处理</small> : null}
        </div>
        <div className="desktop-approval-summary">{view.primary}</div>
        {view.secondary ? <div className="desktop-approval-meta">{view.secondary}</div> : null}
        {error ? <div className="desktop-approval-error">{error}</div> : null}
      </div>
      <div className="desktop-approval-actions">
        <button type="button" className="is-deny" disabled={busy} onClick={() => submit('deny')}>
          <X size={16} />
          <span>拒绝</span>
        </button>
        <button type="button" className="is-approve" disabled={busy} onClick={() => submit('approve')}>
          <Check size={16} />
          <span>{busyDecision === 'approve' ? '处理中' : '允许一次'}</span>
        </button>
      </div>
    </section>
  );
}
