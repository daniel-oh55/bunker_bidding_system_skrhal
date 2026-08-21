import { type ChangeEvent, type FormEvent, useRef, useState } from 'react';
import { parseBunkerRequest, type BunkerRequestDraft } from './bid-intake';
import type { BidInput } from './bidding-client';
import { localInputToIso } from './datetime';
import { readMsgFile } from './msg-intake';
import { fuelGrades, type ActiveBuyer, type FuelGrade } from './types';

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

export function CreateBidForm({ buyers, disabled, onSubmit }: { buyers: ActiveBuyer[]; disabled: boolean; onSubmit: (input: BidInput) => Promise<boolean> }) {
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
  const selectionRevision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

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
    if (rows.some((row, index) => !row.quantity || !Number.isFinite(quantities[index]) || quantities[index]! <= 0)) return;
    const succeeded = await onSubmit({
      vesselVoyage: vessel,
      portName: port,
      deliveryWindow: window,
      deadlineAt: localInputToIso(deadline),
      responsibleBuyerUserId: responsible || null,
      fuelGrades: rows.map((row) => row.grade),
      quantities,
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
      selectionRevision.current += 1;
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return <details className="panel buyer-create-panel"><summary><span>Create new bid</span><small>Set commercial terms and assign responsibility</small></summary><form className="operation-form buyer-create-form" onSubmit={(event) => void submit(event)}><section className="msg-intake" aria-labelledby="msg-intake-heading"><div><h3 id="msg-intake-heading">Import bunker request (.msg)</h3><p className="buyer-form-helper">Select one local Outlook file (maximum 5 MiB). It is parsed in this browser and is not uploaded.</p></div><label>Outlook message<input ref={fileInput} aria-label="Bunker request .msg file" type="file" accept=".msg" disabled={disabled || parsingMsg} onChange={(event) => void selectMsg(event)} /></label>{parsingMsg ? <p className="buyer-form-helper" role="status">Parsing local file…</p> : null}{msgError ? <p className="notice error" role="alert">{msgError}</p> : null}{msgDraft ? <MsgDraftPreview draft={msgDraft} disabled={disabled} onApply={applyMsgDraft} /> : null}</section>{hasAppliedImport ? <p className="notice warning imported-draft-helper">Imported values are a draft. Verify vessel/voyage, port, delivery, fuel grade and quantity before creating the bid.</p> : null}<div className="buyer-create-fields"><label>Vessel / voyage<input required disabled={disabled} value={vessel} onChange={(event) => setVessel(event.target.value)} /></label><label>Port<input required disabled={disabled} value={port} onChange={(event) => setPort(event.target.value)} /></label><label>Delivery window<input required disabled={disabled} value={window} onChange={(event) => setWindow(event.target.value)} /></label><label>Deadline<input aria-label="Create deadline" type="datetime-local" disabled={disabled} value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label><label>Responsible BUYER<select disabled={disabled} value={responsible} onChange={(event) => setResponsible(event.target.value)}><option value="">Current actor</option>{buyers.map((buyer) => <option value={buyer.user_id} key={buyer.user_id}>{buyer.display_label}</option>)}</select></label></div><FuelRows rows={rows} onChange={setRows} disabled={disabled} /><div className="buyer-create-actions"><p className="buyer-form-helper">The server validates the bid and returns the authoritative record.</p><button type="submit" disabled={disabled}>Create bid</button></div></form></details>;
}
