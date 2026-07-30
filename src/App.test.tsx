import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('renders the foundation smoke screen', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { name: /supabase v2 foundation/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/legacy firebase files are preserved/i)).toBeInTheDocument();
  });
});
