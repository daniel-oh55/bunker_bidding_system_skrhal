import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge, WorkspaceEmptyState, WorkspaceSummary } from './workspace-ui';

describe('workspace UI primitives', () => {
  it('renders a supplied operational summary and action without owning that action', () => {
    render(<WorkspaceSummary eyebrow="BUYER operations" title="Bid management" summary="3 current bids" action={<button type="button">Refresh</button>} />);

    expect(screen.getByText('BUYER operations')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bid management' })).toBeInTheDocument();
    expect(screen.getByText('3 current bids')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });

  it('renders a text-bearing status badge', () => {
    render(<StatusBadge status="closed" label="Effective status" />);

    expect(screen.getByText('Effective status: closed')).toHaveClass('status-closed');
  });

  it('renders a clear empty-state title and instruction', () => {
    render(<WorkspaceEmptyState title="No accessible bids" description="Check again later or use Refresh." />);

    expect(screen.getByRole('status')).toHaveTextContent('No accessible bids');
    expect(screen.getByRole('status')).toHaveTextContent('Check again later or use Refresh.');
  });
});
