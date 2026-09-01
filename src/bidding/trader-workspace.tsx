import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { BiddingClient, QuoteInput } from './bidding-client';
import type { Quote, TraderBid, WorkflowError } from './types';
import { StatusBadge, WorkspaceEmptyState, WorkspaceSummary } from '../ui/workspace-ui';
import { currentSeoulDate, millisecondsUntilNextSeoulDate } from './datetime';

const amount = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
const remainingTime = (deadline: string | null, nowMs: number) => {
  if (!deadline) return 'No deadline';
  const remainingSeconds = Math.ceil((new Date(deadline).getTime() - nowMs) / 1000);
  if (remainingSeconds <= 0) return 'Expired';
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m ${seconds}s remaining`;
};

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
  const [nowMs, setNowMs] = useState(() => Date.now());

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
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const reloadRef = useRef<() => void>(() => {});
  reloadRef.current = () => { void load(); };
  useEffect(() => { if (reloadVersion > 0) reloadRef.current(); }, [reloadVersion]);
  useEffect(() => {
    let timer: number;
    const scheduleRollover = () => {
      timer = window.setTimeout(() => {
        clear();
        setNowMs(Date.now());
        void load();
        scheduleRollover();
      }, millisecondsUntilNextSeoulDate() + 25);
    };
    scheduleRollover();
    return () => window.clearTimeout(timer);
  }, [clear, load]);

  const submitResponse = async (bid: TraderBid, quote: Quote | undefined, input: QuoteInput) => {
    const operation = ++operationRef.current;
    setPending(true);
    setError(null);

    let result: { data: Quote | null; error: WorkflowError | null };
    try {
      result = await client.submitQuoteResponse(
        membershipId,
        bid.id,
        bid.response_revision,
        quote?.revision ?? null,
        input,
      );
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

  const giveUp = async (bid: TraderBid) => {
    const operation = ++operationRef.current;
    setPending(true);
    setError(null);
    let result;
    try { result = await client.giveUpQuoteResponse(membershipId, bid.id, bid.response_revision); }
    catch { result = { data: null, error: unknownError }; }
    if (operation !== operationRef.current) return;
    setPending(false);
    if (result.error) {
      if (result.error.kind === 'authorization') { authorizationFailure(result.error); return; }
      if (result.error.code === '40001' || result.error.code === '55000' || result.error.code === 'P0002') { await load(result.error); return; }
      setError(result.error);
      return;
    }
    await load();
  };

  const openBidCount = bids.filter((bid) => bid.effective_status === 'open').length;
  const ownQuoteCount = bids.filter((bid) => bid.response_status === 'quoted').length;

  return (
    <div className="workspace trader-workspace">
      <WorkspaceSummary
        eyebrow="TRADER operations"
        title="Quote workspace"
        summary={
          <span className="trader-summary-metrics">
            <span><strong>{currentSeoulDate(nowMs)}</strong> Seoul date</span>
            <span><strong>{openBidCount}</strong> open for quoting</span>
            <span><strong>{ownQuoteCount}</strong> active {ownQuoteCount === 1 ? 'quote' : 'quotes'}</span>
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
                key={`${bid.id}:${bid.revision}:${bid.response_revision}:${quote?.id ?? 'new'}:${quote?.revision ?? 0}`}
                bid={bid}
                quote={quote}
                pending={pending}
                onSave={submitResponse}
                onGiveUp={giveUp}
                currentTimeMs={nowMs}
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
  onGiveUp,
  currentTimeMs,
}: {
  bid: TraderBid;
  quote?: Quote;
  pending: boolean;
  onSave: (bid: TraderBid, quote: Quote | undefined, input: QuoteInput) => Promise<void>;
  onGiveUp: (bid: TraderBid) => Promise<void>;
  currentTimeMs: number;
}) {
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
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
  const resultClass = bid.effective_status === 'awarded'
    ? quote?.is_awarded ? ' result-selected' : ' result-not-selected'
    : ' result-terminal';

  return (
    <article className={`panel trader-card status-${bid.effective_status}${editable ? ' is-editable' : ' is-terminal'}`}>
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
            <dt>Remaining time</dt>
            <dd><span className={`deadline-countdown${remainingTime(bid.deadline_at, currentTimeMs) === 'Expired' ? ' is-expired' : ''}`}>{remainingTime(bid.deadline_at, currentTimeMs)}</span><small className="countdown-note">Client clock, advisory only</small></dd>
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
        className={`trader-quote-state response-${bid.response_status}`}
        aria-label="Own response state"
      >
        <div>
          <p className="eyebrow">Quote status</p>
          <h3>{bid.response_status === 'awaiting' ? 'Awaiting your response' : bid.response_status === 'quoted' ? 'Submitted' : 'Gave up'}</h3>
          <p>
            {bid.response_status === 'gave_up'
              ? 'No current price offer is active.'
              : bid.response_status === 'quoted'
                ? 'Your organization has an active price response on this bid.'
                : 'Submit prices or give up while this bid remains open.'}
          </p>
        </div>
        {quote ? (
          <dl>
            <div>
              <dt>Response revision</dt>
              <dd>{bid.response_revision}</dd>
            </div>
            <div>
              <dt>Retained server total</dt>
              <dd className="server-value">{amount(quote.total_amount)}</dd>
            </div>
          </dl>
        ) : null}
      </section>

      {editable ? (
        <form className="operation-form trader-quote-editor" onSubmit={submit}>
          <header className="trader-quote-editor-heading">
            <div>
              <p className="eyebrow">Quote editor</p>
              <h3>{bid.response_status === 'quoted' ? 'Update price' : bid.response_status === 'gave_up' ? 'Resume / Submit price' : 'Submit price'}</h3>
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
                  <span className="trader-input-label"><span>Unit price</span><small>Editable</small></span>
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
              <span className="trader-input-label"><span>Barge fee</span><small>Editable</small></span>
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
            ) : (
              <div className="trader-authoritative-total is-pending">
                <dt>Authoritative server total</dt>
                <dd>Not submitted</dd>
                <p>The server returns this value after your quote is saved.</p>
              </div>
            )}
          </dl>
          <div className="trader-quote-actions">
            <button type="submit" disabled={!canSave || pending}>
              {bid.response_status === 'quoted' ? 'Update price' : bid.response_status === 'gave_up' ? 'Resume / Submit price' : 'Submit price'}
            </button>
            {bid.response_status !== 'gave_up' ? (
              confirmGiveUp ? <button type="button" className="danger" disabled={pending} onClick={() => void onGiveUp(bid)}>Confirm GIVE UP</button>
                : <button type="button" className="secondary" disabled={pending} onClick={() => setConfirmGiveUp(true)}>GIVE UP</button>
            ) : null}
            {confirmGiveUp ? <button type="button" className="secondary" disabled={pending} onClick={() => setConfirmGiveUp(false)}>Keep responding</button> : null}
          </div>
        </form>
      ) : (
        <>
          <div className={`terminal-result trader-terminal-result${resultClass}`} role="status">
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
        <div className="trader-read-only-total">
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
