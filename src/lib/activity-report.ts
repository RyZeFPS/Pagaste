import type { ActivityExportLabels, ActivityHistoryRecord } from '@/lib/activity-history';
import { activityCounterparty, activityCounterpartyKey } from '@/lib/activity-history';
import type { ActivityExportCopy } from '@/features/activity/export-copy';

type MoneyTotals = Record<string, number>;

export type ActivityReportMovement = {
  id: string;
  date: string;
  person: string;
  direction: string;
  expense: string;
  merchant: string;
  group: string;
  context: string;
  status: string;
  amount: string;
  amountCents: number;
  currency: string;
  incoming: boolean;
};

export type ActivityReportModel = {
  title: string;
  subtitle: string;
  generatedAt: string;
  overview: {
    pendingToReceive: string;
    pendingToPay: string;
    received: string;
    issues: string;
  };
  movements: ActivityReportMovement[];
};

export type ActivityReportOptions = {
  userId?: string | null;
  copy: ActivityExportCopy;
  labels: ActivityExportLabels;
  formatMoney: (cents: number, currency?: string) => string;
  formatDate: (iso: string) => string;
  generatedAt?: Date;
};

export type ParticipantVisualSummary = {
  name: string;
  svg: string;
  fallbackText: string;
};

function hasOpenIncident(record: ActivityHistoryRecord): boolean {
  return record.status === 'disputed' || record.disputes.some((item) => item.status === 'open');
}

function isPending(record: ActivityHistoryRecord): boolean {
  return record.status === 'pending' || record.status === 'reminder_sent';
}

function addMoney(totals: MoneyTotals, currency: string, cents: number): void {
  totals[currency] = (totals[currency] ?? 0) + cents;
}

function formatMoneyTotals(
  totals: MoneyTotals,
  formatMoney: ActivityReportOptions['formatMoney'],
  empty: string,
): string {
  const entries = Object.entries(totals).filter(([, cents]) => cents !== 0);
  if (!entries.length) return empty;
  return entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, cents]) => formatMoney(cents, currency))
    .join(' / ');
}

function movementFromRecord(
  record: ActivityHistoryRecord,
  options: ActivityReportOptions,
): ActivityReportMovement {
  const { incoming, person } = activityCounterparty(record, options.userId);
  const expense = record.expense;
  const currency = expense?.currency ?? 'EUR';
  const context = [expense?.merchant_name, expense?.group?.name].filter(Boolean).join(' · ');
  return {
    id: record.id,
    date: options.formatDate(expense?.occurred_at ?? record.created_at),
    person: person?.display_name ?? options.labels.notAvailable,
    direction: incoming ? options.labels.incoming : options.labels.outgoing,
    expense: expense?.title ?? options.labels.notAvailable,
    merchant: expense?.merchant_name ?? options.labels.notAvailable,
    group: expense?.group?.name ?? options.labels.notAvailable,
    context,
    status: options.labels.statusLabel(record.status),
    amount: options.formatMoney(record.amount_cents, currency),
    amountCents: record.amount_cents,
    currency,
    incoming,
  };
}

export function buildActivityReportModel(
  records: readonly ActivityHistoryRecord[],
  options: ActivityReportOptions,
): ActivityReportModel {
  const pendingToReceive: MoneyTotals = {};
  const pendingToPay: MoneyTotals = {};
  const received: MoneyTotals = {};
  const issues: MoneyTotals = {};

  for (const record of records) {
    const { incoming } = activityCounterparty(record, options.userId);
    const currency = record.expense?.currency ?? 'EUR';
    if (record.status === 'received') addMoney(received, currency, record.amount_cents);
    else if (hasOpenIncident(record)) addMoney(issues, currency, record.amount_cents);
    else if (isPending(record)) {
      addMoney(incoming ? pendingToPay : pendingToReceive, currency, record.amount_cents);
    }
  }

  const generatedAt = options.generatedAt ?? new Date();
  return {
    title: options.copy.reportTitle,
    subtitle: options.copy.reportSubtitle(records.length),
    generatedAt: options.copy.generatedAt(options.formatDate(generatedAt.toISOString())),
    overview: {
      pendingToReceive: formatMoneyTotals(
        pendingToReceive,
        options.formatMoney,
        options.copy.noAmount,
      ),
      pendingToPay: formatMoneyTotals(pendingToPay, options.formatMoney, options.copy.noAmount),
      received: formatMoneyTotals(received, options.formatMoney, options.copy.noAmount),
      issues: formatMoneyTotals(issues, options.formatMoney, options.copy.noAmount),
    },
    movements: records.map((record) => movementFromRecord(record, options)),
  };
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function spreadsheetCell(value: string, style = ''): string {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ''}><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

function exactDecimal(cents: number): string {
  const negative = cents < 0;
  const absolute = BigInt(negative ? -cents : cents);
  return `${negative ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

/**
 * Builds SpreadsheetML 2003 without a runtime dependency. Excel and LibreOffice
 * open this as a real workbook with overview and activity worksheets.
 */
export function buildActivityExcelXml(
  records: readonly ActivityHistoryRecord[],
  options: ActivityReportOptions,
): string {
  const report = buildActivityReportModel(records, options);
  const overviewRows = [
    [options.copy.pendingToReceive, report.overview.pendingToReceive],
    [options.copy.pendingToPay, report.overview.pendingToPay],
    [options.copy.received, report.overview.received],
    [options.copy.issues, report.overview.issues],
  ]
    .map(
      ([label, value]) =>
        `<Row>${spreadsheetCell(label, 'Label')}${spreadsheetCell(value, 'Amount')}</Row>`,
    )
    .join('');
  const movementHeaders = [
    options.labels.date,
    options.labels.person,
    options.labels.direction,
    options.labels.expense,
    options.labels.merchant,
    options.labels.group,
    options.labels.status,
    options.labels.amount,
    options.labels.currency,
  ]
    .map((label) => spreadsheetCell(label, 'Header'))
    .join('');
  const movementRows = report.movements
    .map(
      (movement) =>
        `<Row>${[
          movement.date,
          movement.person,
          movement.direction,
          movement.expense,
          movement.merchant,
          movement.group,
          movement.status,
        ]
          .map((value) => spreadsheetCell(value))
          .join('')}<Cell ss:StyleID="Decimal"><Data ss:Type="Number">${exactDecimal(
          movement.amountCents,
        )}</Data></Cell>${spreadsheetCell(movement.currency)}</Row>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Arial" ss:Size="18" ss:Bold="1" ss:Color="#1769E8"/></Style>
  <Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#1769E8" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Label"><Font ss:Bold="1"/></Style>
  <Style ss:ID="Amount"><Font ss:Bold="1" ss:Color="#111827"/></Style>
  <Style ss:ID="Decimal"><NumberFormat ss:Format="0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="${xmlEscape(options.copy.overview)}">
  <Table>
   <Column ss:Width="190"/><Column ss:Width="140"/>
   <Row><Cell ss:StyleID="Title"><Data ss:Type="String">${xmlEscape(report.title)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">${xmlEscape(report.subtitle)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">${xmlEscape(report.generatedAt)}</Data></Cell></Row>
   <Row/>
   ${overviewRows}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="${xmlEscape(options.copy.movements)}">
  <Table>
   <Column ss:Width="90"/><Column ss:Width="120"/><Column ss:Width="90"/>
   <Column ss:Width="180"/><Column ss:Width="140"/><Column ss:Width="120"/><Column ss:Width="100"/>
   <Column ss:Width="90"/><Column ss:Width="55"/>
   <Row>${movementHeaders}</Row>
   ${movementRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions>
 </Worksheet>
</Workbook>`;
}

const WIN_1252: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

function pdfString(value: string): string {
  let result = '';
  for (const character of value.normalize('NFC')) {
    const codePoint = character.codePointAt(0) ?? 63;
    const byte = codePoint <= 0xff ? codePoint : (WIN_1252[character] ?? '?'.charCodeAt(0));
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) {
      result += `\\${String.fromCharCode(byte)}`;
    } else if (byte < 0x20 || byte > 0x7e) {
      result += `\\${byte.toString(8).padStart(3, '0')}`;
    } else {
      result += String.fromCharCode(byte);
    }
  }
  return result;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…` : value;
}

function pdfText(
  text: string,
  x: number,
  y: number,
  size: number,
  font: 'F1' | 'F2' = 'F1',
  color = '0.067 0.094 0.153',
): string {
  return `${color} rg BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${pdfString(text)}) Tj ET`;
}

function pdfRoundedCard(
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): string {
  return `${color} rg ${x} ${y} ${width} ${height} re f`;
}

function buildPdfPage(
  report: ActivityReportModel,
  options: ActivityReportOptions,
  movements: readonly ActivityReportMovement[],
  page: number,
  pageCount: number,
): string {
  const commands: string[] = ['1 1 1 rg 0 0 595 842 re f'];
  commands.push('0.090 0.412 0.910 rg 0 742 595 100 re f');
  commands.push(pdfText(report.title, 36, 796, 22, 'F2', '1 1 1'));
  commands.push(
    pdfText(
      page === 1 ? report.subtitle : options.copy.page(page, pageCount),
      36,
      770,
      10,
      'F1',
      '0.910 0.949 1',
    ),
  );
  if (page === 1) {
    commands.push(pdfText(report.generatedAt, 410, 770, 9, 'F1', '0.910 0.949 1'));
    commands.push(pdfText(options.copy.overview, 36, 714, 13, 'F2'));
    const cards = [
      [options.copy.pendingToReceive, report.overview.pendingToReceive, '0.918 0.949 1'],
      [options.copy.pendingToPay, report.overview.pendingToPay, '1 0.949 0.910'],
      [options.copy.received, report.overview.received, '0.914 0.976 0.941'],
      [options.copy.issues, report.overview.issues, '0.992 0.929 0.933'],
    ] as const;
    cards.forEach(([label, amount, color], index) => {
      const x = 36 + index * 132;
      commands.push(pdfRoundedCard(x, 646, 120, 54, color));
      commands.push(pdfText(truncate(label, 22), x + 10, 680, 7.5, 'F1', '0.4 0.44 0.51'));
      commands.push(pdfText(truncate(amount, 20), x + 10, 658, 10.5, 'F2'));
    });
  }

  // Keep continuation-page headings entirely below the blue masthead.
  // A higher baseline lets the ascenders overlap the masthead visually.
  const tableTop = page === 1 ? 612 : 700;
  commands.push(pdfText(options.copy.movements, 36, tableTop + 18, 13, 'F2'));
  commands.push('0.949 0.961 0.984 rg 36 ' + (tableTop - 7) + ' 523 27 re f');
  commands.push(pdfText(options.labels.date, 44, tableTop + 2, 8, 'F2', '0.4 0.44 0.51'));
  commands.push(pdfText(options.labels.person, 112, tableTop + 2, 8, 'F2', '0.4 0.44 0.51'));
  commands.push(pdfText(options.labels.expense, 220, tableTop + 2, 8, 'F2', '0.4 0.44 0.51'));
  commands.push(pdfText(options.labels.status, 406, tableTop + 2, 8, 'F2', '0.4 0.44 0.51'));
  commands.push(pdfText(options.labels.amount, 492, tableTop + 2, 8, 'F2', '0.4 0.44 0.51'));

  movements.forEach((movement, index) => {
    const y = tableTop - 43 - index * 50;
    if (index % 2 === 1) commands.push(`0.980 0.984 0.992 rg 36 ${y - 10} 523 46 re f`);
    commands.push(pdfText(truncate(movement.date, 12), 44, y + 10, 8.5));
    commands.push(pdfText(truncate(movement.person, 20), 112, y + 12, 9.5, 'F2'));
    commands.push(
      pdfText(truncate(movement.direction, 20), 112, y - 2, 7.5, 'F1', '0.4 0.44 0.51'),
    );
    commands.push(pdfText(truncate(movement.expense, 30), 220, y + 12, 9, 'F2'));
    commands.push(pdfText(truncate(movement.context, 35), 220, y - 2, 7.5, 'F1', '0.4 0.44 0.51'));
    commands.push(pdfText(truncate(movement.status, 18), 406, y + 5, 8.5));
    commands.push(pdfText(truncate(movement.amount, 16), 492, y + 5, 8.5, 'F2'));
    commands.push(`0.933 0.941 0.957 RG 36 ${y - 12} m 559 ${y - 12} l S`);
  });
  commands.push(pdfText(options.copy.page(page, pageCount), 486, 24, 8, 'F1', '0.596 0.635 0.702'));
  return commands.join('\n');
}

function assemblePdf(pageStreams: readonly string[]): Uint8Array {
  const objects: string[] = [];
  const add = (value: string) => {
    objects.push(value);
    return objects.length;
  };
  const catalogId = add('');
  const pagesId = add('');
  const regularFontId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const boldFontId = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const pageIds: number[] = [];
  for (const stream of pageStreams) {
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n%Pagaste\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

/** Generates a dependency-free, multi-page A4 PDF using vector text and shapes. */
export function buildActivityPdf(
  records: readonly ActivityHistoryRecord[],
  options: ActivityReportOptions,
): Uint8Array {
  const report = buildActivityReportModel(records, options);
  const firstPageSize = 10;
  const otherPageSize = 13;
  const pages: ActivityReportMovement[][] = [report.movements.slice(0, firstPageSize)];
  for (let index = firstPageSize; index < report.movements.length; index += otherPageSize) {
    pages.push(report.movements.slice(index, index + otherPageSize));
  }
  const nonEmptyPages = pages.length ? pages : [[]];
  return assemblePdf(
    nonEmptyPages.map((movements, index) =>
      buildPdfPage(report, options, movements, index + 1, nonEmptyPages.length),
    ),
  );
}

function svgEscape(value: string): string {
  return xmlEscape(value);
}

function initial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? 'P';
}

function svgText(
  value: string,
  x: number,
  y: number,
  size: number,
  weight = 500,
  color = '#111827',
  anchor: 'start' | 'middle' | 'end' = 'start',
): string {
  return `<text x="${x}" y="${y}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${svgEscape(value)}</text>`;
}

export function buildParticipantSummarySvg(
  records: readonly ActivityHistoryRecord[],
  participantKey: string,
  options: ActivityReportOptions,
  fallbackText: string,
): ParticipantVisualSummary | null {
  const selected = records.filter(
    (record) => activityCounterpartyKey(record, options.userId) === participantKey,
  );
  if (!selected.length) return null;
  const personName =
    activityCounterparty(selected[0], options.userId).person?.display_name ??
    options.labels.notAvailable;
  const report = buildActivityReportModel(selected, options);
  const recent = report.movements.slice(0, 6);
  const height = 930 + recent.length * 88;
  const metrics = [
    [options.copy.pendingToReceive, report.overview.pendingToReceive, '#EAF2FF', '#1769E8'],
    [options.copy.pendingToPay, report.overview.pendingToPay, '#FFF2E8', '#B54708'],
    [options.copy.received, report.overview.received, '#E9F9F0', '#067647'],
    [options.copy.issues, report.overview.issues, '#FDEDEE', '#B42318'],
  ] as const;
  const metricSvg = metrics
    .map(([label, amount, background, ink], index) => {
      const x = 72 + (index % 2) * 470;
      const y = 350 + Math.floor(index / 2) * 168;
      return [
        `<rect x="${x}" y="${y}" width="438" height="140" rx="32" fill="${background}"/>`,
        svgText(label, x + 28, y + 43, 23, 600, '#667085'),
        svgText(truncate(amount, 24), x + 28, y + 99, 34, 750, ink),
      ].join('');
    })
    .join('');
  const movementSvg = recent
    .map((movement, index) => {
      const y = 760 + index * 88;
      return [
        index
          ? `<line x1="94" y1="${y - 30}" x2="986" y2="${y - 30}" stroke="#EEF0F4" stroke-width="2"/>`
          : '',
        `<circle cx="116" cy="${y}" r="27" fill="${movement.incoming ? '#FFF2E8' : '#EAF2FF'}"/>`,
        svgText(
          movement.incoming ? '↓' : '↑',
          116,
          y + 10,
          30,
          700,
          movement.incoming ? '#B54708' : '#1769E8',
          'middle',
        ),
        svgText(truncate(movement.expense, 32), 164, y - 3, 25, 650),
        svgText(
          truncate([movement.date, movement.context].filter(Boolean).join(' · '), 52),
          164,
          y + 29,
          19,
          450,
          '#667085',
        ),
        svgText(truncate(movement.amount, 20), 958, y - 2, 25, 700, '#111827', 'end'),
        svgText(truncate(movement.status, 22), 958, y + 28, 18, 550, '#667085', 'end'),
      ].join('');
    })
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}" viewBox="0 0 1080 ${height}">
 <rect width="1080" height="${height}" fill="#F5F7FB"/>
 <rect x="0" y="0" width="1080" height="244" fill="#1769E8"/>
 <circle cx="116" cy="132" r="58" fill="#FFFFFF" fill-opacity=".18"/>
 ${svgText(initial(personName), 116, 151, 50, 750, '#FFFFFF', 'middle')}
 ${svgText(personName, 202, 121, 42, 750, '#FFFFFF')}
 ${svgText(options.copy.reportTitle, 202, 165, 24, 500, '#EAF2FF')}
 ${svgText(report.generatedAt, 202, 200, 19, 450, '#EAF2FF')}
 ${svgText(options.copy.overview, 72, 312, 30, 700)}
 ${metricSvg}
 ${svgText(options.copy.movements, 72, 708, 30, 700)}
 <rect x="72" y="730" width="936" height="${Math.max(112, recent.length * 88 + 36)}" rx="34" fill="#FFFFFF"/>
 ${movementSvg}
 ${svgText(options.copy.visualSummaryFooter, 540, height - 62, 18, 450, '#667085', 'middle')}
</svg>`;
  return { name: personName, svg, fallbackText };
}
