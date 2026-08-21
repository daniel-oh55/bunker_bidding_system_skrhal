import { describe, expect, it } from 'vitest';
import { parseBunkerRequest } from './bid-intake';

describe('bunker request draft parser', () => {
  it('extracts vessel and voyage only from a clear subject prefix', () => {
    const draft = parseBunkerRequest({
      subject: 'TEST VESSEL 2601E / BUNKER REQUEST AT BUSAN',
      body: '',
    });

    expect(draft.vesselVoyage).toBe('TEST VESSEL 2601E');
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
