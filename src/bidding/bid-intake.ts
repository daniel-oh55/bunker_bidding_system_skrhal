export type BunkerRequestSource = {
  subject: string;
  body: string;
};

export type BunkerRequestDraft = {
  vesselVoyage?: string;
  portName?: string;
  deliveryWindow?: string;
  fuelItems: Array<{ grade: FuelGrade; quantity: number }>;
  warnings: string[];
};

const supportedAliases = {
  HSHFO: 'hsfo',
  HSFO: 'hsfo',
  VLSFO: 'vlsfo',
  ULSFO: 'ulsfo',
  LSFO: 'lsfo',
  LSMGO: 'lsmgo',
} as const;

type FuelGrade = (typeof supportedAliases)[keyof typeof supportedAliases];
type SupportedAlias = keyof typeof supportedAliases;

const bunkerRequestWording = String.raw`BUNKER\s+(?:REQUEST|REQUISITION|REQ(?:UEST)?)`;
const nonRequestFuelContext = /\b(?:ROB|REMAINING\s+ON\s+BOARD|CONSUMPTION|PRICE|QUOTE|OFFER|USD|EUR|SGD|BARGING\s+FEE|AWARD)\b|[$€]/i;
const otherFuelTerm = /^(?:MGO|MDO|HFO|IFO(?:\s*\d+)?|RMG\s*\d+)\b/i;
const explicitUnsupportedMtLine = /^[^:]{1,60}:\s*\S+\s*M\s*\/?\s*T\b/i;

function firstBodyField(body: string, labels: string[]): string | undefined {
  const lines = body.split(/\r?\n/);
  for (const label of labels) {
    const pattern = new RegExp(String.raw`^\s*(?:[-*•]\s*)?${label}\s*:\s*(.+?)\s*$`, 'i');
    for (const line of lines) {
      const value = line.match(pattern)?.[1]?.trim();
      if (value) return value;
    }
  }
  return undefined;
}

function parseVesselVoyage(subject: string): string | undefined {
  const match = subject.match(new RegExp(String.raw`^\s*(.+?)\s*(?:\/|-)\s*${bunkerRequestWording}\b`, 'i'));
  return match?.[1]?.trim() || undefined;
}

function parseSubjectPort(subject: string): string | undefined {
  const match = subject.match(new RegExp(String.raw`\b${bunkerRequestWording}\b.*?\bAT\s+(.+?)\s*$`, 'i'));
  return match?.[1]?.replace(/^[-/\s]+|[-/\s]+$/g, '').trim() || undefined;
}

function parseQuantityToken(token: string): number | undefined {
  if (!/^[+-]?(?:\d+(?:,\d{3})*(?:\.\d+)?|\d*\.\d+)$/.test(token)) return undefined;
  const quantity = Number(token.replaceAll(',', ''));
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

type StructuredSubjectSummary = {
  vesselVoyage: string;
  deliveryWindow: string;
  portName: string;
};

const englishMonth = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)`;

function parseStructuredSubjectSummary(subject: string): StructuredSubjectSummary | undefined {
  const match = subject.match(/\(\s*([^()/]+?)\s*\/\s*([^()/]+?)\s*\/\s*([^()/]+?)\s*\)\s*$/);
  if (!match) return undefined;

  const vesselVoyage = match[1]?.trim();
  const deliveryWindow = match[2]?.trim();
  const portName = match[3]?.trim();
  if (!vesselVoyage || !deliveryWindow || !portName) return undefined;

  const hasMonth = new RegExp(String.raw`\b${englishMonth}\b`, 'i').test(deliveryWindow);
  const hasYear = /\b\d{4}\b/.test(deliveryWindow);
  return hasMonth && hasYear ? { vesselVoyage, deliveryWindow, portName } : undefined;
}

function isSupportedAlias(alias: string): alias is SupportedAlias {
  return Object.hasOwn(supportedAliases, alias);
}

function parseFuelItems(body: string, warnings: string[]): BunkerRequestDraft['fuelItems'] {
  const candidates = new Map<FuelGrade, Set<number>>();

  for (const sourceLine of body.split(/\r?\n/)) {
    const line = sourceLine.replace(/^\s*[-*•]\s*/, '').trim();
    if (!line || nonRequestFuelContext.test(line)) continue;

    const supported = line.match(/^(HSHFO|HSFO|VLSFO|ULSFO|LSFO|LSMGO)\b/i);
    if (!supported) {
      if ((otherFuelTerm.test(line) || explicitUnsupportedMtLine.test(line)) && /\bM\s*\/?\s*T\b/i.test(line)) {
        warnings.push('Unsupported or ambiguous fuel line was not imported; enter it manually.');
      }
      continue;
    }

    const alias = supported[1]!.toUpperCase();
    if (!isSupportedAlias(alias)) continue;
    const grade = supportedAliases[alias];
    const quantityMarker = line.match(/(\S+)\s*M\s*\/?\s*T\b/i);
    if (!quantityMarker) continue;
    const amountToken = quantityMarker[1];
    const quantity = amountToken ? parseQuantityToken(amountToken) : undefined;
    if (quantity === undefined) {
      warnings.push(`Invalid ${alias} quantity was not imported.`);
      continue;
    }

    const quantities = candidates.get(grade) ?? new Set<number>();
    quantities.add(quantity);
    candidates.set(grade, quantities);
  }

  const fuelItems: BunkerRequestDraft['fuelItems'] = [];
  for (const [grade, quantities] of candidates) {
    if (quantities.size > 1) {
      warnings.push(`Conflicting quantities for ${grade.toUpperCase()} were not imported; resolve them manually.`);
      continue;
    }
    const quantity = quantities.values().next().value;
    if (quantity !== undefined) fuelItems.push({ grade, quantity });
  }

  if (fuelItems.length === 0) {
    warnings.push('No usable supported fuel grade and quantity was found; enter fuel items manually.');
  }
  return fuelItems;
}

export function parseBunkerRequest({ subject, body }: BunkerRequestSource): BunkerRequestDraft {
  const warnings: string[] = [];
  const structuredSubject = parseStructuredSubjectSummary(subject);
  const vesselVoyage = firstBodyField(body, [String.raw`VSL\s*\/\s*VOY`, String.raw`VESSEL\s*\/\s*VOYAGE`, 'VSL', 'VESSEL'])
    ?? parseVesselVoyage(subject)
    ?? structuredSubject?.vesselVoyage;
  const portName = firstBodyField(body, [String.raw`PORT\s*\/\s*TERMINAL`, String.raw`BUNKER\s+PORT`, 'PORT'])
    ?? parseSubjectPort(subject)
    ?? structuredSubject?.portName;
  let deliveryWindow = firstBodyField(body, [String.raw`DELIVERY\s+WINDOW`, String.raw`DELIVERY\s+DATE`, String.raw`SUPPLY\s+DATE`]);

  deliveryWindow ??= structuredSubject?.deliveryWindow;

  if (!deliveryWindow) {
    const eta = firstBodyField(body, ['ETA']);
    if (eta) {
      deliveryWindow = `ETA ${eta}`;
      warnings.push('ETA was used only as a delivery hint; the BUYER must verify the delivery window.');
    }
  }

  const fuelItems = parseFuelItems(body, warnings);
  return {
    ...(vesselVoyage ? { vesselVoyage } : {}),
    ...(portName ? { portName } : {}),
    ...(deliveryWindow ? { deliveryWindow } : {}),
    fuelItems,
    warnings,
  };
}
