import { describe, expect, it } from 'vitest';
import { parseBunkerRequest } from './bid-intake';

describe('bunker request draft parser', () => {
  it('preserves the existing clear English BUNKER REQUEST subject extraction', () => {
    const draft = parseBunkerRequest({
      subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT BUSAN',
      body: '',
    });

    expect(draft.vesselVoyage).toBe('TEST VESSEL 2601E');
    expect(draft.portName).toBe('BUSAN');
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it.each([
    ['VSL', 'TEST STAR 2609E'],
    ['VESSEL', 'TEST MOON 2610W'],
    ['VSL / VOY', 'TEST SUN 2611E'],
    ['VESSEL / VOYAGE', 'TEST CLOUD 2612W'],
  ])('extracts an explicit %s body field without normalizing its value', (label, expected) => {
    const draft = parseBunkerRequest({ subject: '', body: `${label} : ${expected}\nVLSFO : 10 MT` });

    expect(draft.vesselVoyage).toBe(expected);
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it.each(['-', '*', '•'])('accepts an optional %s bullet for operational body fields', (bullet) => {
    const draft = parseBunkerRequest({
      subject: '',
      body: `${bullet} VSL : TEST STAR 2609E\n${bullet} PORT / TERMINAL : TEST PORT / TEST TERMINAL\n${bullet} ETA : 06th Sep 2026\nVLSFO : 10 MT`,
    });

    expect(draft).toMatchObject({
      vesselVoyage: 'TEST STAR 2609E',
      portName: 'TEST PORT / TEST TERMINAL',
      deliveryWindow: 'ETA 06th Sep 2026',
    });
    expect(draft.warnings).toContainEqual(expect.stringContaining('ETA was used only as a delivery hint'));
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('prefers an explicit body vessel over both subject fallbacks', () => {
    const draft = parseBunkerRequest({
      subject: 'SUBJECT STAR 2609E / BUNKER REQUEST AT SUBJECT PORT (STRUCTURED STAR 2610W / 06th Sep 2026 / STRUCTURED PORT)',
      body: 'VSL : BODY STAR 2611E\nVLSFO : 10 MT',
    });

    expect(draft.vesselVoyage).toBe('BODY STAR 2611E');
  });

  it('extracts a narrow synthetic structured subject with one delivery date', () => {
    const draft = parseBunkerRequest({
      subject: 'Synthetic request (TEST STAR 2609E / 06th Sep 2026 / BUSAN, KOREA)',
      body: 'VLSFO : 10 MT',
    });

    expect(draft).toMatchObject({ vesselVoyage: 'TEST STAR 2609E', deliveryWindow: '06th Sep 2026', portName: 'BUSAN, KOREA' });
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('extracts a narrow synthetic structured subject with a delivery date range', () => {
    const draft = parseBunkerRequest({
      subject: 'Synthetic request\n(TEST STAR 2609E / 02~07th September 2026 / SHANGHAI, CHINA)',
      body: 'VLSFO : 10 MT',
    });

    expect(draft).toMatchObject({ vesselVoyage: 'TEST STAR 2609E', deliveryWindow: '02~07th September 2026', portName: 'SHANGHAI, CHINA' });
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('does not parse arbitrary slash-parenthetical text without a recognized month and year', () => {
    const draft = parseBunkerRequest({
      subject: 'Discussion (ALPHA / status pending / internal only)',
      body: 'VLSFO : 10 MT',
    });

    expect(draft).not.toHaveProperty('vesselVoyage');
    expect(draft).not.toHaveProperty('portName');
    expect(draft).not.toHaveProperty('deliveryWindow');
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('prefers an explicit body port over the subject fallback', () => {
    const draft = parseBunkerRequest({
      subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT ULSAN',
      body: 'PORT : BUSAN, KOREA\nVLSFO : 10 MT',
    });

    expect(draft.portName).toBe('BUSAN, KOREA');
  });

  it('preserves useful terminal text from an explicit port field', () => {
    const draft = parseBunkerRequest({
      subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT ULSAN',
      body: 'PORT / TERMINAL : BUSAN, KOREA / TEST TERMINAL\nVLSFO : 10 MT',
    });

    expect(draft.portName).toBe('BUSAN, KOREA / TEST TERMINAL');
  });

  it('prefers an explicit body port over the structured subject port', () => {
    const draft = parseBunkerRequest({
      subject: 'Synthetic request (TEST STAR 2609E / 06th Sep 2026 / SUBJECT PORT)',
      body: '- PORT / TERMINAL : BODY PORT / TEST TERMINAL\nVLSFO : 10 MT',
    });

    expect(draft.portName).toBe('BODY PORT / TEST TERMINAL');
  });

  it('uses the subject port only when no explicit body port exists', () => {
    const draft = parseBunkerRequest({
      subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT BUSAN',
      body: 'VLSFO : 10 MT',
    });

    expect(draft.portName).toBe('BUSAN');
  });

  it('prefers an explicit delivery window over delivery date, supply date, and ETA', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'ETA : 07th Jul 2026\nSUPPLY DATE : 08th Jul 2026\nDELIVERY DATE : 09th Jul 2026\nDELIVERY WINDOW : 10-11 Jul 2026\nVLSFO : 10 MT',
    });

    expect(draft.deliveryWindow).toBe('10-11 Jul 2026');
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('ETA was used'));
  });

  it.each([
    ['DELIVERY WINDOW', '05-06 Sep 2026'],
    ['DELIVERY DATE', '05th Sep 2026'],
    ['SUPPLY DATE', '05th September 2026'],
  ])('prefers explicit %s over a structured subject date', (label, expected) => {
    const draft = parseBunkerRequest({
      subject: 'Synthetic request (TEST STAR 2609E / 06th Sep 2026 / TEST PORT)',
      body: `${label} : ${expected}\nETA : 07th Sep 2026\nVLSFO : 10 MT`,
    });

    expect(draft.deliveryWindow).toBe(expected);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('ETA was used'));
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('uses a structured subject date before ETA without an ETA-used warning', () => {
    const draft = parseBunkerRequest({
      subject: 'Synthetic request (TEST STAR 2609E / 06th Sep 2026 / TEST PORT)',
      body: '- ETA : 07th Sep 2026\nVLSFO : 10 MT',
    });

    expect(draft.deliveryWindow).toBe('06th Sep 2026');
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('ETA was used'));
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it('uses ETA only as a delivery hint with a verification warning and never a deadline', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'ETA : 07th Jul 2026\nVLSFO : 10 MT',
    });

    expect(draft.deliveryWindow).toBe('ETA 07th Jul 2026');
    expect(draft.warnings).toContainEqual(expect.stringContaining('ETA was used only as a delivery hint'));
    expect(draft).not.toHaveProperty('deadlineAt');
  });

  it.each([
    ['HSHFO RMG380', 'hsfo'],
    ['HSFO RMG380', 'hsfo'],
    ['VLSFO', 'vlsfo'],
    ['ULSFO', 'ulsfo'],
    ['LSFO', 'lsfo'],
    ['LSMGO DMA', 'lsmgo'],
  ] as const)('maps the explicit %s alias without changing its base grade', (sourceGrade, expectedGrade) => {
    const draft = parseBunkerRequest({ subject: '', body: `${sourceGrade} : 12.5 MT` });

    expect(draft.fuelItems).toEqual([{ grade: expectedGrade, quantity: 12.5 }]);
  });

  it.each([
    ['hyphen compact', '40-50 MT', 40],
    ['tilde compact', '40~50 MT', 40],
    ['spaced hyphen', '40 - 50 MT', 40],
    ['en dash', '40\u201350 MT', 40],
    ['em dash', '40\u201450 MT', 40],
    ['full-width tilde', '40\uFF5E50 MT', 40],
    ['case-insensitive marker', '100-150mt', 100],
    ['M/T marker', '100 ~ 150 M/T', 100],
    ['comma-formatted range', '1,000-1,200 MT', 1000],
    ['decimal range', '12.5-15 MT', 12.5],
    ['equal bounds', '40-40 MT', 40],
  ])('imports the lower bound for a valid %s quantity range', (_label, range, expected) => {
    const draft = parseBunkerRequest({ subject: '', body: `VLSFO : ${range}` });

    expect(draft.fuelItems).toEqual([{ grade: 'vlsfo', quantity: expected }]);
    expect(draft.warnings).toEqual([
      'VLSFO quantity range was imported using its lower bound; verify before creating the bid.',
    ]);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Invalid VLSFO quantity'));
  });

  it.each([
    ['zero lower bound', '0-50 MT'],
    ['negative lower bound', '-5-50 MT'],
    ['zero upper bound', '40-0 MT'],
    ['negative upper bound', '40--5 MT'],
    ['reversed range', '50-40 MT'],
    ['malformed upper bound', '40-many MT'],
    ['ordinary invalid token', 'many MT'],
  ])('rejects a %s through the existing invalid-quantity path', (_label, quantity) => {
    const draft = parseBunkerRequest({ subject: '', body: `VLSFO : ${quantity}` });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).toContain('Invalid VLSFO quantity was not imported.');
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('using its lower bound'));
  });

  it.each([
    ['12.5 MT', 12.5],
    ['1,000 MT', 1000],
  ])('preserves the existing single-quantity grammar for %s', (quantity, expected) => {
    const draft = parseBunkerRequest({ subject: '', body: `VLSFO : ${quantity}` });

    expect(draft.fuelItems).toEqual([{ grade: 'vlsfo', quantity: expected }]);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('quantity range'));
  });

  it('ignores supported-grade specification rows without MT/M/T and emits no false invalid-quantity warning', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'HSHFO RMG380 : ISO 8217 specification\nLSMGO DMA : ISO 8217 specification',
    });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Invalid HSHFO quantity'));
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Invalid LSMGO quantity'));
  });

  it('uses a valid supported request row alongside a specification row without a false warning', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'HSHFO RMG380 : ISO 8217 specification\nHSHFO RMG380 : 700 MT\nLSMGO DMA : ISO 8217 specification\nLSMGO DMA : 50 M/T',
    });

    expect(draft.fuelItems).toEqual([
      { grade: 'hsfo', quantity: 700 },
      { grade: 'lsmgo', quantity: 50 },
    ]);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Invalid HSHFO quantity'));
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Invalid LSMGO quantity'));
  });

  it.each(['VLSFO : many MT', 'VLSFO : -5 M/T'])('still rejects and warns for an invalid supported quantity marker: %s', (body) => {
    const draft = parseBunkerRequest({ subject: '', body });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Invalid VLSFO quantity'));
  });

  it('does not silently map bare generic MGO', () => {
    const draft = parseBunkerRequest({ subject: '', body: 'MGO DMA : 15 MT' });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Unsupported or ambiguous fuel line'));
  });

  it('warns instead of guessing an unsupported explicit fuel grade', () => {
    const draft = parseBunkerRequest({ subject: '', body: 'TESTFUEL : 20 MT' });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Unsupported or ambiguous fuel line'));
  });

  it.each(['0', '-5', 'many', 'NaN', 'Infinity'])('rejects a %s MT supported-grade quantity', (quantity) => {
    const draft = parseBunkerRequest({ subject: '', body: `VLSFO : ${quantity} MT` });

    expect(draft.fuelItems).toEqual([]);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Invalid VLSFO quantity'));
  });

  it('warns and omits a supported grade when aliases conflict on quantity', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'HSHFO RMG380 : 400 MT\nHSFO RMG380 : 450 MT\nLSMGO DMA : 15 MT',
    });

    expect(draft.fuelItems).toEqual([{ grade: 'lsmgo', quantity: 15 }]);
    expect(draft.warnings).toContainEqual(expect.stringContaining('Conflicting quantities for HSFO'));
  });

  it('deduplicates identical quantities for aliases of the same supported grade', () => {
    const draft = parseBunkerRequest({
      subject: '',
      body: 'HSHFO RMG380 : 400 MT\nHSFO RMG380 : 400 MT',
    });

    expect(draft.fuelItems).toEqual([{ grade: 'hsfo', quantity: 400 }]);
    expect(draft.warnings).not.toContainEqual(expect.stringContaining('Conflicting quantities'));
  });

  it('ignores seller, supplier, barge, signature, comparison, quote, and award information', () => {
    const draft = parseBunkerRequest({
      subject: 'Commercial correspondence',
      body: [
        'SELLER : TEST SELLER',
        'SUPPLIER : TEST SUPPLIER',
        'BARGE : TEST BARGE',
        'VLSFO ROB : 250 MT',
        'VLSFO QUOTE PRICE : 600 USD / MT',
        'AWARD : TEST TRADER',
        'Regards,',
        'Test Person',
      ].join('\n'),
    });

    expect(draft).toEqual({
      fuelItems: [],
      warnings: ['No usable supported fuel grade and quantity was found; enter fuel items manually.'],
    });
  });

  it('returns a partial draft without inventing missing fields', () => {
    const draft = parseBunkerRequest({ subject: '', body: 'BUNKER PORT : TEST PORT\nLSMGO : 15 MT' });

    expect(draft).toMatchObject({
      portName: 'TEST PORT',
      fuelItems: [{ grade: 'lsmgo', quantity: 15 }],
    });
    expect(draft).not.toHaveProperty('vesselVoyage');
    expect(draft).not.toHaveProperty('deliveryWindow');
    expect(draft).not.toHaveProperty('deadlineAt');
  });
});
