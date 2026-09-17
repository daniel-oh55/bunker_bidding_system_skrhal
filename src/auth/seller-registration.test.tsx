import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublicSellerRegistration, sellerRegistrationEnabled } from './seller-registration';
import type { AccessClient } from './access-client';

describe('SELLER registration presentation flag', () => {
  it.each([[undefined, false], ['', false], ['false', false], ['TRUE', false], ['true ', false], ['true', true]] as const)('accepts only exact true: %s', (value, expected) => expect(sellerRegistrationEnabled(value)).toBe(expected));

  it('submits only email/password and shows confirmation guidance', async () => {
    const signUpSeller = vi.fn(() => Promise.resolve({ data: null, error: false }));
    const client = { signUpSeller, verifySellerInvite: vi.fn(), inviteSellerRegistration: vi.fn(), updatePassword: vi.fn(), signOut: vi.fn() } as unknown as AccessClient;
    render(<PublicSellerRegistration client={client} onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create SELLER account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'seller@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create SELLER account' }));
    await waitFor(() => expect(signUpSeller).toHaveBeenCalledWith('seller@example.test', 'password'));
    expect(await screen.findByText('Check your email to confirm your address, then return to sign in.')).toBeInTheDocument();
    expect(screen.queryByText(/BUYER role/i)).not.toBeInTheDocument();
  });
});
