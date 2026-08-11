import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, QuoteInput } from './bidding-client';
import type { Quote, TraderBid, WorkflowError } from './types';

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

  return (
    <div className="workspace">
      <section className="panel workspace-summary">
        <div>
          <p className="eyebrow">TRADER operations</p>
          <h2>Quote workspace</h2>
          <p>
            {openBidCount} open for quoting · {bids.length} accessible{' '}
            {bids.length === 1 ? 'bid' : 'bids'}
          </p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={loading || pending}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </section>
      {error ? (
        <p className="notice error" role="alert">
          {error.message}
        </p>
      ) : null}
      <section className="trader-bids" aria-label="Trader bids">
        {loading ? (
          <p className="panel">Loading available bids</p>
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
      <h2>{bid.vessel_voyage}</h2>
      <dl className="operational-data">
        <div>
          <dt>Port</dt>
          <dd>{bid.port_name}</dd>
        </div>
        <div>
          <dt>Delivery window</dt>
          <dd>{bid.delivery_window}</dd>
        </div>
        <div>
          <dt>Effective status</dt>
          <dd>{bid.effective_status}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{bid.deadline_at ? new Date(bid.deadline_at).toLocaleString() : 'No deadline'}</dd>
        </div>
        <div>
          <dt>Fuel requested</dt>
          <dd>
            {bid.fuel_items
              .map((item) => `${item.fuel_grade.toUpperCase()} ${item.quantity_mt}`)
              .join(', ')}
          </dd>
        </div>
        {quote ? (
          <>
            <div>
              <dt>Own quote revision</dt>
              <dd>{quote.revision}</dd>
            </div>
            <div>
              <dt>Authoritative server total</dt>
              <dd>{amount(quote.total_amount)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {editable ? (
        <form className="operation-form" onSubmit={submit}>
          <h3>{quote ? 'Update your quote' : 'Create quote'}</h3>
          {bid.fuel_items.map((item) => (
            <label key={item.fuel_grade}>
              {item.fuel_grade.toUpperCase()} unit price
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
          ))}
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
          <p>Estimated preview: {amount(preview)}</p>
          {quote ? <p>Authoritative server total: {amount(quote.total_amount)}</p> : null}
          <button type="submit" disabled={!canSave || pending}>
            {quote ? 'Update quote' : 'Save quote'}
          </button>
        </form>
      ) : (
        <>
          <p className="terminal-result" role="status">
            {terminalMessage}
          </p>
          {quote ? <ReadOnlyQuoteSummary quote={quote} /> : null}
        </>
      )}
    </article>
  );
}

function ReadOnlyQuoteSummary({ quote }: { quote: Quote }) {
  return (
    <section className="read-only-quote" aria-label="Your quote summary">
      <h3>Your quote</h3>
      <dl className="operational-data">
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
