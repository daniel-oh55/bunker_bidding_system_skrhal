import type { ReactNode } from 'react';

export function WorkspaceSummary({
  eyebrow,
  title,
  summary,
  action,
}: {
  eyebrow: string;
  title: string;
  summary: ReactNode;
  action: ReactNode;
}) {
  return (
    <section className="panel workspace-summary">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="workspace-summary-copy">{summary}</p>
      </div>
      <div className="workspace-summary-action">{action}</div>
    </section>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      {label ? `${label}: ` : ''}{status}
    </span>
  );
}

export function WorkspaceEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="workspace-empty-state" role="status">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
