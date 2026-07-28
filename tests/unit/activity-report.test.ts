import { describe, expect, it } from 'vitest';
import { getActivityExportCopy } from '../../src/features/activity/export-copy';
import {
  activityCounterpartyKey,
  type ActivityExportLabels,
  type ActivityHistoryRecord,
} from '../../src/lib/activity-history';
import {
  buildActivityExcelXml,
  buildActivityPdf,
  buildActivityReportModel,
  buildParticipantSummarySvg,
  type ActivityReportOptions,
} from '../../src/lib/activity-report';

const currentUserId = 'user-current';

function makeRecord(
  id: string,
  overrides: Partial<ActivityHistoryRecord> = {},
): ActivityHistoryRecord {
  return {
    id,
    expense_id: `expense-${id}`,
    amount_cents: 850,
    status: 'pending',
    sent_at: '2026-07-24T10:00:00.000Z',
    created_at: '2026-07-24T10:00:00.000Z',
    debtor: {
      id: `debtor-${id}`,
      user_id: 'user-ferran',
      display_name: 'Ferran & amigos',
      avatar_path: null,
    },
    creditor: {
      id: `creditor-${id}`,
      user_id: currentUserId,
      display_name: 'RyZe',
      avatar_path: null,
    },
    expense: {
      id: `expense-${id}`,
      title: `Cena <especial> ${id}`,
      merchant_name: 'La Pizzería',
      occurred_at: '2026-07-24T10:00:00.000Z',
      currency: 'EUR',
      group_id: 'group-friends',
      group: { id: 'group-friends', name: 'Amigos' },
      items: [{ id: `item-${id}`, name: 'Pizza' }],
    },
    disputes: [],
    events: [],
    ...overrides,
  };
}

const labels: ActivityExportLabels = {
  date: 'Fecha',
  person: 'Persona',
  direction: 'Dirección',
  expense: 'Gasto',
  merchant: 'Comercio / grupo',
  group: 'Grupo',
  products: 'Productos',
  status: 'Estado',
  amount: 'Importe',
  currency: 'Moneda',
  incoming: 'Debes',
  outgoing: 'Te deben',
  notAvailable: 'Sin datos',
  statusLabel: (status) => status,
  formatDate: (iso) => iso.slice(0, 10),
};

const options: ActivityReportOptions = {
  userId: currentUserId,
  copy: getActivityExportCopy('es'),
  labels,
  formatMoney: (cents, currency = 'EUR') => `${cents} ${currency}`,
  formatDate: labels.formatDate,
  generatedAt: new Date('2026-07-26T12:00:00.000Z'),
};

describe('activity visual exports', () => {
  it('builds direction-aware overview totals without mixing currencies', () => {
    const incoming = makeRecord('incoming', {
      debtor: {
        id: 'debtor-current',
        user_id: currentUserId,
        display_name: 'RyZe',
        avatar_path: null,
      },
      creditor: {
        id: 'creditor-marta',
        user_id: 'user-marta',
        display_name: 'Marta',
        avatar_path: null,
      },
      amount_cents: 1_250,
      expense: {
        ...makeRecord('base').expense!,
        id: 'expense-incoming',
        currency: 'USD',
      },
    });
    const received = makeRecord('received', { status: 'received', amount_cents: 2_000 });
    const report = buildActivityReportModel([makeRecord('pending'), incoming, received], options);

    expect(report.overview.pendingToReceive).toBe('850 EUR');
    expect(report.overview.pendingToPay).toBe('1250 USD');
    expect(report.overview.received).toBe('2000 EUR');
    expect(report.movements[1]).toMatchObject({
      incoming: true,
      person: 'Marta',
      currency: 'USD',
    });
  });

  it('creates a valid multi-page PDF with an xref table and localized WinAnsi text', () => {
    const records = Array.from({ length: 25 }, (_, index) => makeRecord(`movement-${index + 1}`));
    const pdf = buildActivityPdf(records, options);
    const content = new TextDecoder().decode(pdf);

    expect(content.startsWith('%PDF-1.4')).toBe(true);
    expect(content).toContain('/Type /Catalog');
    expect(content).toContain('/Count 3');
    expect(content).toContain('/Encoding /WinAnsiEncoding');
    expect(content).toContain('xref');
    expect(content.endsWith('%%EOF')).toBe(true);

    const xrefIndex = content.indexOf('\nxref\n') + 1;
    const xrefLines = content.slice(xrefIndex).split('\n');
    const objectCount = Number(xrefLines[1]?.split(' ')[1]);
    expect(objectCount).toBeGreaterThan(1);
    for (let objectId = 1; objectId < objectCount; objectId += 1) {
      const offset = Number(xrefLines[objectId + 2]?.slice(0, 10));
      expect(content.slice(offset).startsWith(`${objectId} 0 obj\n`)).toBe(true);
    }
  });

  it('creates an Excel-compatible workbook with escaped cells and exact decimals', () => {
    const xml = buildActivityExcelXml([makeRecord('one', { amount_cents: 12_345 })], options);

    expect(xml).toContain('<?mso-application progid="Excel.Sheet"?>');
    expect(xml).toContain('<Worksheet ss:Name="Resumen">');
    expect(xml).toContain('<Worksheet ss:Name="Movimientos">');
    expect(xml).toContain('Cena &lt;especial&gt; one');
    expect(xml).toContain('<Data ss:Type="Number">123.45</Data>');
    expect(xml).not.toContain('123.450000');
  });

  it('creates a branded, safely escaped visual summary for one participant', () => {
    const record = makeRecord('visual');
    const participantKey = activityCounterpartyKey(record, currentUserId);
    const visual = buildParticipantSummarySvg(
      [record],
      participantKey,
      options,
      'Resumen alternativo',
    );

    expect(visual).not.toBeNull();
    expect(visual?.name).toBe('Ferran & amigos');
    expect(visual?.svg).toContain('<svg');
    expect(visual?.svg).toContain('#1769E8');
    expect(visual?.svg).toContain('Ferran &amp; amigos');
    expect(visual?.svg).toContain('Cena &lt;especial&gt; visual');
    expect(visual?.fallbackText).toBe('Resumen alternativo');
    expect(visual?.svg).not.toContain('Ferran & amigos');
  });
});
