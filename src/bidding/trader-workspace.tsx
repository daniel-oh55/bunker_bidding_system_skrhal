import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, QuoteInput } from './bidding-client';
import type { Quote, TraderBid, WorkflowError } from './types';
import { StatusBadge, WorkspaceEmptyState, WorkspaceSummary } from '../ui/workspace-ui';

const amount = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

const unknownError: WorkflowError = {
  kind: 'unknown',
  code: null,
  message: 'The request could not be completed. Please try again.',
};

export function TraderWorkspace({
  client,
  membershipId,
  onAuthorizationFailure,
  reloadVersion = 0,
}: {
  client: BiddingClient;
  membershipId: string;
  onAuthorizationFailure: () => void;
  reloadVersion?: number;
}) {
  const operationRef = useRef(0);
  const [bids, setBids] = useState<TraderBid[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [error, setError] = useState<WorkflowError | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);

  const clear = useCallback(() => {
    setBids([]);
    setQuotes([]);
  }, []);

  const invalidateOperations = useCallback(() => {
    ++operationRef.current;
  }, []);

  const authorizationFailure = useCallback(
    (failure: WorkflowError) => {
      invalidateOperations();
      clear();
      setError(failure);
      onAuthorizationFailure();
    },
    [clear, invalidateOperations, onAuthorizationFailure],
  );

  const load = useCallback(
    async (errorAfterReload?: WorkflowError) => {
      const operation = ++operationRef.current;
      setLoading(true);
      setError(null);
      clear();

      try {
        const [bidResult, quoteResult] = await Promise.all([
          client.listTraderBids(membershipId),
          client.listMyQuotes(membershipId),
        ]);

        if (operation !== operationRef.current) return false;

        const failure = bidResult.error ?? quoteResult.error;
        if (failure) {
          if (failure.kind === 'authorization') authorizationFailure(failure);
          else setError(failure);

          setLoading(false);
          return false;
        }

        setBids(bidResult.data ?? []);
        setQuotes(quoteResult.data ?? []);
        setError(errorAfterReload ?? null);
        setLoading(false);
        return true;
      } catch {
        if (operation === operationRef.current) {
          clear();
          setError(unknownError);
          setLoading(false);
        }

        return false;
      }
    },
    [authorizationFailure, clear, client, membershipId],
  );

  useEffect(() => {
    void load();
    return invalidateOperations;
  }, [invalidateOperations, load]);
  const reloadRef = useRef<() => void>(() => {});
  reloadRef.current = () => { void load(); };
  useEffect(() => { if (reloadVersion > 0) reloadRef.current(); }, [reloadVersion]);

  const save = async (bid: TraderBid, quote: Quote | undefined, input: QuoteInput) => {
    const operation = ++operationRef.current;
    setPending(true);
    setError(null);

    let result: { data: Quote | null; error: WorkflowError | null };
    try {
      result = quote
        ? await client.updateQuote(membershipId, quote.id, quote.revision, input)
        : await client.createQuote(membershipId, bid.id, input);
    } catch {
      result = { data: null, error: unknownError };
    }

    if (operation !== operationRef.current) return;

    setPending(false);
    if (result.error) {
      if (result.error.kind === 'authorization') {
        authorizationFailure(result.error);
        return;
      }

      if (
        result.error.code === '40001' ||
        result.error.code === '55000' ||
        result.error.code === 'P0002'
      ) {
        await load(result.error);
        return;
      }

      setError(result.error);
      return;
    }

    await load();
  };

  const openBidCount = bids.filter((bid) => bid.effective_status === 'open').length;
  const ownQuoteCount = quotes.length;

  return (
    <div className="workspace trader-workspace">
      <WorkspaceSummary
        eyebrow="TRADER operations"
        title="Quote workspace"
        summary={
          <span className="trader-summary-metrics">
            <span><strong>{openBidCount}</strong> open for quoting</span>
            <span><strong>{ownQuoteCount}</strong> own-organization {ownQuoteCount === 1 ? 'quote' : 'quotes'}</span>
            <span><strong>{bids.length}</strong> accessible {bids.length === 1 ? 'bid' : 'bids'}</span>
          </span>
        }
        action={<button
          type="button"
          className="secondary"
          disabled={loading || pending}
          onClick={() => void load()}
        >
          Refresh
        </button>}
      />
      {error ? (
        <p className="notice error" role="alert">
          {error.message}
        </p>
      ) : null}
      <section className="trader-bids" aria-label="Trader bids">
        {loading ? (
          <WorkspaceEmptyState title="Loading available bids" description="Retrieving bids your organization can access." />
        ) : bids.length === 0 ? (
          <WorkspaceEmptyState title="No accessible bids" description="No bids are currently available to your organization. Use Refresh to check again." />
        ) : (
          bids.map((bid) => {
            const quote = quotes.find((candidate) => candidate.bid_id === bid.id);

            return (
              <TraderBidCard
                key={`${bid.id}:${bid.revision}:${quote?.id ?? 'new'}:${quote?.revision ?? 0}`}
                bid={bid}
                quote={quote}
                pending={pending}
                onSave={save}
              />
            );
          })
        )}
      </section>
    </div>
  );
}

function TraderBidCard({
  bid,
  quote,
  pending,
  onSave,
}: {
  bid: TraderBid;
  quote?: Quote;
  pending: boolean;
  onSave: (bid: TraderBid, quote: Quote | undefined, input: QuoteInput) => Promise<void>;
}) {
  const [prices, setPrices] = useState(() =>
    Object.fromEntries(
      bid.fuel_items.map((item) => [
        item.fuel_grade,
        String(
          quote?.fuel_prices.find((price) => price.fuel_grade === item.fuel_grade)
            ?.unit_price ?? '',
        ),
      ]),
    ),
  );
  const [bargeFee, setBargeFee] = useState(String(quote?.barge_fee ?? ''));
  const editable = bid.effective_status === 'open';
  const canSave =
    editable &&
    bid.fuel_items.every(
      (item) =>
        Number.isFinite(Number(prices[item.fuel_grade])) &&
        Number(prices[item.fuel_grade]) > 0,
    ) &&
    Number.isFinite(Number(bargeFee)) &&
    Number(bargeFee) >= 0;
  const preview = bid.fuel_items.reduce(
    (total, item) => total + item.quantity_mt * (Number(prices[item.fuel_grade]) || 0),
    Number(bargeFee) || 0,
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (canSave) {
      void onSave(bid, quote, {
        fuelGrades: bid.fuel_items.map((item) => item.fuel_grade),
        unitPrices: bid.fuel_items.map((item) => Number(prices[item.fuel_grade])),
        bargeFee: Number(bargeFee),
      });
    }
  };
  const terminalMessage =
    bid.effective_status === 'awarded'
      ? quote
        ? quote.is_awarded
          ? 'Selected. Your organization’s quote was selected.'
          : 'Not selected. The award process is complete.'
        : 'The award process is complete.'
      : bid.effective_status === 'cancelled'
        ? 'This bid has been cancelled.'
        : 'Quote submission is closed.';

  return (
    <article className="panel trader-card">
      <header className="trader-card-heading">
        <div>
          <p className="eyebrow">Accessible bid</p>
          <h2>{bid.vessel_voyage}</h2>
          <p className="trader-card-port">Port: {bid.port_name}</p>
        </div>
        <div className="trader-card-status">
          <span>Effective status</span>
          <StatusBadge status={bid.effective_status} />
        </div>
      </header>

      <section className="trader-bid-requirements" aria-label={`Bid requirements for ${bid.vessel_voyage}`}>
        <h3>Bid requirements</h3>
        <dl className="operational-data trader-bid-timing">
          <div>
            <dt>Deadline</dt>
            <dd>{bid.deadline_at ? new Date(bid.deadline_at).toLocaleString() : 'No deadline'}</dd>
          </div>
          <div>
            <dt>Delivery window</dt>
            <dd>{bid.delivery_window}</dd>
          </div>
        </dl>
        <div className="trader-requested-fuels">
          <h4>Fuel requested</h4>
          <ul>
            {bid.fuel_items.map((item) => (
              <li key={item.fuel_grade}>
                <strong>{item.fuel_grade.toUpperCase()}</strong>
                <span>{amount(item.quantity_mt)} MT requested</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className={`trader-quote-state ${quote ? 'has-own-quote' : 'no-own-quote'}`}
        aria-label="Own quote state"
      >
        <div>
          <p className="eyebrow">Own quote status</p>
          <h3>{quote ? 'Own quote submitted' : 'No own quote submitted'}</h3>
          <p>
            {quote
              ? 'Your organization has a quote on this bid.'
              : 'Your organization has not submitted a quote for this bid.'}
          </p>
        </div>
        {quote ? (
          <dl>
            <div>
              <dt>Own quote revision</dt>
              <dd>{quote.revision}</dd>
            </div>
            <div>
              <dt>Authoritative server total</dt>
              <dd>{amount(quote.total_amount)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {editable ? (
        <form className="operation-form trader-quote-editor" onSubmit={submit}>
          <header className="trader-quote-editor-heading">
            <div>
              <p className="eyebrow">Quote editor</p>
              <h3>{quote ? 'Update your quote' : 'Create quote'}</h3>
            </div>
            <p>Enter a unit price for each requested fuel, then add the barge fee.</p>
          </header>
          <div className="trader-fuel-price-list">
            {bid.fuel_items.map((item) => (
              <div className="trader-fuel-price-row" key={item.fuel_grade}>
                <div className="trader-fuel-context">
                  <strong>{item.fuel_grade.toUpperCase()}</strong>
                  <span>{amount(item.quantity_mt)} MT requested</span>
                </div>
                <label>
                  Unit price
                  <input
                    aria-label={`${item.fuel_grade} unit price`}
                    type="number"
                    min="0.01"
                    step="any"
                    disabled={pending}
                    value={prices[item.fuel_grade]}
                    onChange={(event) =>
                      setPrices({ ...prices, [item.fuel_grade]: event.target.value })
                    }
                  />
                </label>
              </div>
            ))}
          </div>
          <div className="trader-barge-fee">
            <label>
              Barge fee
              <input
                aria-label="Barge fee"
                type="number"
                min="0"
                step="any"
                disabled={pending}
                value={bargeFee}
                onChange={(event) => setBargeFee(event.target.value)}
              />
            </label>
          </div>
          <dl className="trader-quote-totals" aria-label="Quote totals">
            <div className="trader-client-estimate">
              <dt>Client estimate</dt>
              <dd>{amount(preview)}</dd>
              <p>Preview only. The server calculates the authoritative total after submission.</p>
            </div>
            {quote ? (
              <div className="trader-authoritative-total">
                <dt>Authoritative server total</dt>
                <dd>{amount(quote.total_amount)}</dd>
                <p>Current total returned by the server.</p>
              </div>
            ) : null}
          </dl>
          <div className="trader-quote-actions">
            <button type="submit" disabled={!canSave || pending}>
              {quote ? 'Update quote' : 'Save quote'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="terminal-result trader-terminal-result" role="status">
            <span>Bid result</span>
            <strong>{terminalMessage}</strong>
          </div>
          {quote ? <ReadOnlyQuoteSummary quote={quote} /> : null}
        </>
      )}
    </article>
  );
}

function ReadOnlyQuoteSummary({ quote }: { quote: Quote }) {
  return (
    <section className="read-only-quote" aria-label="Your quote summary">
      <header>
        <p className="eyebrow">Read-only</p>
        <h3>Your quote</h3>
        <p>This is the final authoritative quote currently returned by the server.</p>
      </header>
      <dl className="operational-data trader-read-only-values">
        {quote.fuel_prices.map((price) => (
          <div key={price.fuel_grade}>
            <dt>{price.fuel_grade.toUpperCase()} unit price</dt>
            <dd>{amount(price.unit_price)}</dd>
          </div>
        ))}
        <div>
          <dt>Barge fee</dt>
          <dd>{amount(quote.barge_fee)}</dd>
        </div>
        <div>
          <dt>Authoritative server total</dt>
          <dd>{amount(quote.total_amount)}</dd>
        </div>
        <div>
          <dt>Own quote revision</dt>
          <dd>{quote.revision}</dd>
        </div>
      </dl>
    </section>
  );
}
