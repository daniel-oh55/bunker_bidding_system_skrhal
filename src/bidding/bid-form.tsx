import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import { parseBunkerRequest, type BunkerRequestDraft } from './bid-intake';
import type { BidInput, PreparedMailIntakeBidInput } from './bidding-client';
import { localInputToIso } from './datetime';
import { readMsgFile } from './msg-intake';
import { fuelGrades, type ActiveBuyer, type FuelGrade, type MailIntakeItem, type TraderOrganization } from './types';

type Row = { grade: FuelGrade; quantity: string };
const emptyRows = (): Row[] => [{ grade: 'vlsfo', quantity: '' }];

export function FuelRows({ rows, onChange, disabled }: { rows: Row[]; onChange: (rows: Row[]) => void; disabled: boolean }) {
  const replace = (index: number, row: Row) => onChange(rows.map((candidate, candidateIndex) => candidateIndex === index ? row : candidate));
  return <fieldset className="buyer-fuel-block"><legend>Fuel items</legend><p className="buyer-form-helper">Add each requested grade once and enter its quantity in metric tons.</p>{rows.map((row, index) => <div className="fuel-row" key={`${row.grade}-${index}`}><label>Grade<select aria-label={`Fuel grade ${index + 1}`} disabled={disabled} value={row.grade} onChange={(event) => replace(index, { ...row, grade: event.target.value as FuelGrade })}>{fuelGrades.map((grade) => <option disabled={rows.some((candidate, candidateIndex) => candidateIndex !== index && candidate.grade === grade)} value={grade} key={grade}>{grade.toUpperCase()}</option>)}</select></label><label>Quantity MT<input aria-label={`Fuel quantity ${index + 1}`} type="number" min="0.01" step="any" required disabled={disabled} value={row.quantity} onChange={(event) => replace(index, { ...row, quantity: event.target.value })} /></label>{rows.length > 1 ? <button type="button" className="secondary" disabled={disabled} onClick={() => onChange(rows.filter((_, candidateIndex) => candidateIndex !== index))}>Remove fuel</button> : null}</div>)}{rows.length < fuelGrades.length ? <button type="button" className="secondary" disabled={disabled} onClick={() => { const grade = fuelGrades.find((candidate) => !rows.some((row) => row.grade === candidate)); if (grade) onChange([...rows, { grade, quantity: '' }]); }}>Add fuel</button> : null}</fieldset>;
}

function MsgDraftPreview({ draft, disabled, onApply }: { draft: BunkerRequestDraft; disabled: boolean; onApply: () => void }) {
  const hasCandidate = Boolean(draft.vesselVoyage || draft.portName || draft.deliveryWindow || draft.fuelItems.length);
  return <div className="msg-intake-preview" aria-live="polite"><h4>Parsed draft</h4><dl>{draft.vesselVoyage ? <div><dt>Vessel / voyage</dt><dd>{draft.vesselVoyage}</dd></div> : null}{draft.portName ? <div><dt>Port</dt><dd>{draft.portName}</dd></div> : null}{draft.deliveryWindow ? <div><dt>Delivery</dt><dd>{draft.deliveryWindow}</dd></div> : null}{draft.fuelItems.length ? <div><dt>Fuel items</dt><dd>{draft.fuelItems.map((item) => `${item.grade.toUpperCase()} ${item.quantity} MT`).join(', ')}</dd></div> : null}</dl>{draft.warnings.length ? <div className="notice warning"><strong>Review warnings</strong><ul>{draft.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}</ul></div> : null}<button type="button" className="secondary" disabled={disabled || !hasCandidate} onClick={onApply}>Apply parsed fields</button></div>;
}

function SellerSelection({ organizations, selectedSellerIds, disabled, onToggle }: { organizations: TraderOrganization[]; selectedSellerIds: Set<string>; disabled: boolean; onToggle: (organizationId: string) => void }) {
  const selectedCount = organizations.filter((organization) => selectedSellerIds.has(organization.organization_id)).length;
  return <fieldset className="prepared-seller-selection"><legend>SELLER participants</legend><p className="buyer-form-helper">All active SELLER organizations are selected by default. Only selected SELLERs receive BID scope when published.</p>{organizations.length === 0 ? <p className="notice warning">At least one active SELLER is required before this BID can be published.</p> : <div>{organizations.map((organization) => <label key={organization.organization_id}><input type="checkbox" aria-label={`Include SELLER ${organization.organization_label}`} disabled={disabled} checked={selectedSellerIds.has(organization.organization_id)} onChange={() => onToggle(organization.organization_id)} /> {organization.organization_label}</label>)}</div>}{selectedCount === 0 && organizations.length > 0 ? <p className="notice warning">Select at least one active SELLER before publishing.</p> : null}</fieldset>;
}

export function CreateBidForm({ buyers, organizations, disabled, onSubmit }: { buyers: ActiveBuyer[]; organizations: TraderOrganization[]; disabled: boolean; onSubmit: (input: BidInput) => Promise<boolean> }) {
  const [rows, setRows] = useState<Row[]>(emptyRows);
  const [vessel, setVessel] = useState('');
  const [port, setPort] = useState('');
  const [window, setWindow] = useState('');
  const [deadline, setDeadline] = useState('');
  const [responsible, setResponsible] = useState('');
  const [msgDraft, setMsgDraft] = useState<BunkerRequestDraft | null>(null);
  const [msgError, setMsgError] = useState('');
  const [parsingMsg, setParsingMsg] = useState(false);
  const [hasAppliedImport, setHasAppliedImport] = useState(false);
  const [selectedSellerIds, setSelectedSellerIds] = useState(() => new Set(organizations.map((organization) => organization.organization_id)));
  const sellerSelectionInitialized = useRef(organizations.length > 0);
  const selectionRevision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sellerSelectionInitialized.current || organizations.length === 0) return;
    sellerSelectionInitialized.current = true;
    setSelectedSellerIds(new Set(organizations.map((organization) => organization.organization_id)));
  }, [organizations]);

  const toggleSeller = (organizationId: string) => setSelectedSellerIds((current) => {
    const next = new Set(current);
    if (next.has(organizationId)) next.delete(organizationId); else next.add(organizationId);
    return next;
  });

  const selectMsg = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const revision = ++selectionRevision.current;
    setMsgDraft(null);
    setMsgError('');
    if (!file) {
      setParsingMsg(false);
      return;
    }

    setParsingMsg(true);
    const result = await readMsgFile(file);
    if (selectionRevision.current !== revision) return;
    setParsingMsg(false);
    if (!result.ok) {
      setMsgError(result.error);
      return;
    }
    setMsgDraft(parseBunkerRequest(result.content));
  };

  const applyMsgDraft = () => {
    if (!msgDraft) return;
    if (msgDraft.vesselVoyage) setVessel(msgDraft.vesselVoyage);
    if (msgDraft.portName) setPort(msgDraft.portName);
    if (msgDraft.deliveryWindow) setWindow(msgDraft.deliveryWindow);
    if (msgDraft.fuelItems.length) {
      setRows(msgDraft.fuelItems.map((item) => ({ grade: item.grade, quantity: String(item.quantity) })));
    }
    setHasAppliedImport(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quantities = rows.map((row) => Number(row.quantity));
    const deadlineAt = localInputToIso(deadline);
    const selectedTraderOrganizationIds = organizations.filter((organization) => selectedSellerIds.has(organization.organization_id)).map((organization) => organization.organization_id);
    if (!deadlineAt || selectedTraderOrganizationIds.length === 0 || rows.some((row, index) => !row.quantity || !Number.isFinite(quantities[index]) || quantities[index]! <= 0)) return;
    const succeeded = await onSubmit({
      vesselVoyage: vessel,
      portName: port,
      deliveryWindow: window,
      deadlineAt,
      responsibleBuyerUserId: responsible || null,
      fuelGrades: rows.map((row) => row.grade),
      quantities,
      selectedTraderOrganizationIds,
    });
    if (succeeded) {
      setRows(emptyRows());
      setVessel('');
      setPort('');
      setWindow('');
      setDeadline('');
      setResponsible('');
      setMsgDraft(null);
      setMsgError('');
      setParsingMsg(false);
      setHasAppliedImport(false);
      setSelectedSellerIds(new Set(organizations.map((organization) => organization.organization_id)));
      selectionRevision.current += 1;
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const selectedSellerCount = organizations.filter((organization) => selectedSellerIds.has(organization.organization_id)).length;
  return <details className="panel buyer-create-panel"><summary><span>Publish new BID</span><small>Set commercial terms, assign responsibility, and select SELLERs</small></summary><form className="operation-form buyer-create-form" onSubmit={(event) => void submit(event)}><section className="msg-intake" aria-labelledby="msg-intake-heading"><div><h3 id="msg-intake-heading">Import bunker request (.msg)</h3><p className="buyer-form-helper">Select one local Outlook file (maximum 5 MiB). It is parsed in this browser and is not uploaded.</p></div><label>Outlook message<input ref={fileInput} aria-label="Bunker request .msg file" type="file" accept=".msg" disabled={disabled || parsingMsg} onChange={(event) => void selectMsg(event)} /></label>{parsingMsg ? <p className="buyer-form-helper" role="status">Parsing local file…</p> : null}{msgError ? <p className="notice error" role="alert">{msgError}</p> : null}{msgDraft ? <MsgDraftPreview draft={msgDraft} disabled={disabled} onApply={applyMsgDraft} /> : null}</section>{hasAppliedImport ? <p className="notice warning imported-draft-helper">Imported values are a draft. Verify vessel/voyage, port, delivery, fuel grade and quantity before publishing the BID.</p> : null}<section className="buyer-create-manual" aria-labelledby="buyer-create-manual-heading"><div className="buyer-editable-heading"><strong id="buyer-create-manual-heading">Bid details</strong><span>Review every editable value before publishing the authoritative BID.</span></div><div className="buyer-create-fields"><label>Vessel / voyage<input required disabled={disabled} value={vessel} onChange={(event) => setVessel(event.target.value)} /></label><label>Port<input required disabled={disabled} value={port} onChange={(event) => setPort(event.target.value)} /></label><label>Delivery window<input required disabled={disabled} value={window} onChange={(event) => setWindow(event.target.value)} /></label><label>Deadline<input aria-label="Create deadline" type="datetime-local" required disabled={disabled} value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label><label>Responsible BUYER<select disabled={disabled} value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="">Current actor</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label></div><FuelRows rows={rows} onChange={setRows} disabled={disabled} /></section><SellerSelection organizations={organizations} selectedSellerIds={selectedSellerIds} disabled={disabled} onToggle={toggleSeller} /><div className="buyer-create-actions"><p className="buyer-form-helper">Publish creates the authoritative BID and selected SELLER response slots.</p><button type="submit" disabled={disabled || selectedSellerCount === 0}>Publish BID</button></div></form></details>;
}

export function PreparedMailIntakeBidForm({ item, buyers, organizations, disabled, onSubmit, onClose }: { item: MailIntakeItem; buyers: ActiveBuyer[]; organizations: TraderOrganization[]; disabled: boolean; onSubmit: (input: PreparedMailIntakeBidInput) => Promise<boolean>; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => item.fuel_items.length ? item.fuel_items.map((fuel) => ({ grade: fuel.grade, quantity: String(fuel.quantity) })) : emptyRows());
  const [vessel, setVessel] = useState(item.vessel_voyage ?? '');
  const [port, setPort] = useState(item.port_name ?? '');
  const [window, setWindow] = useState(item.delivery_window ?? '');
  const [deadline, setDeadline] = useState('');
  const [responsible, setResponsible] = useState('');
  const [selectedSellerIds, setSelectedSellerIds] = useState(() => new Set(organizations.map((organization) => organization.organization_id)));
  const sellerSelectionInitialized = useRef(organizations.length > 0);

  useEffect(() => {
    if (sellerSelectionInitialized.current || organizations.length === 0) return;
    sellerSelectionInitialized.current = true;
    setSelectedSellerIds(new Set(organizations.map((organization) => organization.organization_id)));
  }, [organizations]);

  const toggleSeller = (organizationId: string) => setSelectedSellerIds((current) => {
    const next = new Set(current);
    if (next.has(organizationId)) next.delete(organizationId); else next.add(organizationId);
    return next;
  });
  const selectedSellerCount = organizations.filter((organization) => selectedSellerIds.has(organization.organization_id)).length;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const quantities = rows.map((row) => Number(row.quantity));
    const deadlineAt = localInputToIso(deadline);
    if (!deadlineAt || rows.some((row, index) => !row.quantity || !Number.isFinite(quantities[index]) || quantities[index]! <= 0)) return;
    await onSubmit({
      intakeItemId: item.id,
      expectedIntakeRevision: item.revision,
      vesselVoyage: vessel,
      portName: port,
      deliveryWindow: window,
      deadlineAt,
      responsibleBuyerUserId: responsible || null,
      fuelGrades: rows.map((row) => row.grade),
      quantities,
      selectedTraderOrganizationIds: organizations.filter((organization) => selectedSellerIds.has(organization.organization_id)).map((organization) => organization.organization_id),
    });
  };

  return <section className="panel prepared-mail-bid" aria-labelledby="prepared-mail-bid-heading">
    <header className="prepared-mail-bid-heading"><div><p className="eyebrow">BUYER preparation</p><h2 id="prepared-mail-bid-heading">Prepare BID from mail intake</h2></div><button type="button" className="secondary" disabled={disabled} onClick={onClose}>Close prepared draft</button></header>
    <div className="mail-intake-boundary"><p>This private prepared form does not create a BID until you explicitly Publish.</p><p>Received time is source metadata, not the bidding deadline.</p></div>
    {item.warnings.length ? <aside className="notice warning mail-intake-warnings"><strong>Extraction warnings — review before Publish</strong><ul>{item.warnings.map((warning, index) => <li key={`${item.id}:prepared-warning:${index}`}>{warning}</li>)}</ul></aside> : null}
    <form className="operation-form buyer-create-form" onSubmit={(event) => void submit(event)}>
      <section className="buyer-create-manual" aria-labelledby="prepared-bid-details-heading">
        <div className="buyer-editable-heading"><strong id="prepared-bid-details-heading">Bid details</strong><span>Parsed values are editable candidates. Deadline is required for Publish.</span></div>
        <div className="buyer-create-fields"><label>Prepared vessel / voyage<input aria-label="Prepared vessel / voyage" required disabled={disabled} value={vessel} onChange={(event) => setVessel(event.target.value)} /></label><label>Prepared port<input aria-label="Prepared port" required disabled={disabled} value={port} onChange={(event) => setPort(event.target.value)} /></label><label>Prepared delivery window<input aria-label="Prepared delivery window" required disabled={disabled} value={window} onChange={(event) => setWindow(event.target.value)} /></label><label>Publish deadline<input aria-label="Publish deadline" type="datetime-local" required disabled={disabled} value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label><label>Responsible BUYER<select aria-label="Prepared responsible BUYER" disabled={disabled} value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="">Current actor</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label></div>
        <FuelRows rows={rows} onChange={setRows} disabled={disabled} />
      </section>
      <SellerSelection organizations={organizations} selectedSellerIds={selectedSellerIds} disabled={disabled} onToggle={toggleSeller} />
      <div className="buyer-create-actions"><p className="buyer-form-helper">Publish creates the authoritative BID and selected SELLER response slots exactly once.</p><button type="submit" disabled={disabled || selectedSellerCount === 0}>Publish BID</button></div>
    </form>
  </section>;
}
