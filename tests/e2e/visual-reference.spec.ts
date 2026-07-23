import { expect, test, type Page } from '@playwright/test';
import { createMockSupabase, e2eIds, installMockSupabase, signInFromUi } from './mock-supabase';

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

const ids = {
  david: '99999999-9999-4999-8999-999999999991',
  marta: '99999999-9999-4999-8999-999999999992',
  soda: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  fries: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
  salad: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  dessert: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
  coffee: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  davidClaim: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
  martaClaim: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
} as const;

async function settleVisual(page: Page) {
  await page.waitForTimeout(700);
  await page.waitForFunction(() =>
    Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
  );
}

test('las pantallas de referencia mantienen la composición móvil', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, 'La comprobación visual usa un viewport móvil estable.');
  const backend = createMockSupabase(true);
  backend.expense = {
    ...backend.expense!,
    receipt_path: `${e2eIds.user}/${e2eIds.expense}/visual-ticket.jpg`,
    total_cents: 4_000,
    recoverable_cents: 3_425,
    own_share_cents: 575,
  };
  backend.participants = [
    backend.participants[0],
    backend.participants[1],
    {
      id: ids.david,
      expense_id: e2eIds.expense,
      user_id: null,
      display_name: 'David',
      avatar_path: null,
      email: null,
      phone_e164: null,
      is_payer: false,
      sort_order: 2,
    },
    {
      id: ids.marta,
      expense_id: e2eIds.expense,
      user_id: null,
      display_name: 'Marta',
      avatar_path: null,
      email: null,
      phone_e164: null,
      is_payer: false,
      sort_order: 3,
    },
  ];
  backend.items = [
    {
      id: e2eIds.item,
      expense_id: e2eIds.expense,
      name: 'Pizza',
      quantity: 1,
      unit_price_cents: 1_200,
      line_total_cents: 1_200,
      category: 'food',
      sort_order: 0,
      ocr_confidence: 0.98,
      source: 'ocr',
    },
    {
      id: ids.soda,
      expense_id: e2eIds.expense,
      name: 'Refresco',
      quantity: 2,
      unit_price_cents: 175,
      line_total_cents: 350,
      category: 'drink',
      sort_order: 1,
      ocr_confidence: 0.97,
      source: 'ocr',
    },
    {
      id: ids.fries,
      expense_id: e2eIds.expense,
      name: 'Patatas',
      quantity: 1,
      unit_price_cents: 420,
      line_total_cents: 420,
      category: 'food',
      sort_order: 2,
      ocr_confidence: 0.96,
      source: 'ocr',
    },
    {
      id: ids.salad,
      expense_id: e2eIds.expense,
      name: 'Ensalada',
      quantity: 1,
      unit_price_cents: 680,
      line_total_cents: 680,
      category: 'food',
      sort_order: 3,
      ocr_confidence: 0.95,
      source: 'ocr',
    },
    {
      id: ids.dessert,
      expense_id: e2eIds.expense,
      name: 'Tiramisú',
      quantity: 2,
      unit_price_cents: 275,
      line_total_cents: 550,
      category: 'dessert',
      sort_order: 4,
      ocr_confidence: 0.94,
      source: 'ocr',
    },
    {
      id: ids.coffee,
      expense_id: e2eIds.expense,
      name: 'Café',
      quantity: 2,
      unit_price_cents: 400,
      line_total_cents: 800,
      category: 'drink',
      sort_order: 5,
      ocr_confidence: 0.93,
      source: 'ocr',
    },
  ];
  backend.allocations = [
    allocation('c1', e2eIds.item, e2eIds.guest, 1_200),
    allocation('c2', ids.soda, e2eIds.payer, 175),
    allocation('c3', ids.soda, ids.marta, 175),
    allocation('c4', ids.fries, ids.david, 420),
    allocation('c5', ids.salad, ids.marta, 680),
    allocation('c6', ids.dessert, ids.david, 550),
    allocation('c7', ids.coffee, e2eIds.payer, 400),
    allocation('c8', ids.coffee, ids.david, 400),
  ];
  backend.claims = [
    {
      id: e2eIds.claim,
      expense_id: e2eIds.expense,
      debtor_participant_id: e2eIds.guest,
      creditor_participant_id: e2eIds.payer,
      amount_cents: 1_200,
      status: 'received',
      sent_at: '2026-07-22T10:00:00.000Z',
      viewed_at: '2026-07-22T10:02:00.000Z',
      received_at: '2026-07-22T10:05:00.000Z',
      received_by_user_id: e2eIds.user,
      last_reminded_at: null,
      reminder_count: 0,
    },
    {
      id: ids.davidClaim,
      expense_id: e2eIds.expense,
      debtor_participant_id: ids.david,
      creditor_participant_id: e2eIds.payer,
      amount_cents: 1_370,
      status: 'reminder_sent',
      sent_at: '2026-07-22T10:00:00.000Z',
      viewed_at: null,
      received_at: null,
      received_by_user_id: null,
      last_reminded_at: '2026-07-22T11:00:00.000Z',
      reminder_count: 1,
    },
    {
      id: ids.martaClaim,
      expense_id: e2eIds.expense,
      debtor_participant_id: ids.marta,
      creditor_participant_id: e2eIds.payer,
      amount_cents: 855,
      status: 'pending',
      sent_at: '2026-07-22T10:00:00.000Z',
      viewed_at: '2026-07-22T10:02:00.000Z',
      received_at: null,
      received_by_user_id: null,
      last_reminded_at: null,
      reminder_count: 0,
    },
  ];

  await installMockSupabase(page, backend);
  await page.route('**/rest/v1/receipt_scan_jobs*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        provider: 'visual-fixture',
        status: 'completed',
        confidence: 0.97,
        warnings: [],
        error_code: null,
        completed_at: '2026-07-22T10:00:00.000Z',
      }),
    });
  });
  await page.route('**/storage/v1/**', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          signedURL: '/storage/v1/object/sign/receipts/visual-ticket.jpg?token=visual-reference',
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: receiptSvg,
    });
  });

  await signInFromUi(page);
  await settleVisual(page);

  await expect(page.getByTestId('home-summary-wallet')).toBeVisible();
  for (const testId of ['home-receipt-3d', 'home-manual-3d', 'home-pending-3d', 'home-paid-3d']) {
    const asset = page.getByTestId(testId);
    await expect(asset).toBeVisible();
    await expect
      .poll(() =>
        asset.evaluate((element) => {
          const image =
            element instanceof HTMLImageElement ? element : element.querySelector('img');
          return Boolean(image?.complete && image.naturalWidth > 0);
        }),
      )
      .toBe(true);
  }

  const heroSubtitleBox = await page
    .getByText('Sube tu ticket y recupera tu dinero sin complicaciones.', { exact: true })
    .boundingBox();
  const heroArtworkBox = await page.getByTestId('home-receipt-3d').boundingBox();
  expect(heroSubtitleBox).not.toBeNull();
  expect(heroArtworkBox).not.toBeNull();
  expect(heroSubtitleBox!.x + heroSubtitleBox!.width).toBeLessThan(heroArtworkBox!.x);

  const walletIconCenter = await page.getByTestId('home-wallet-3d').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top + rect.height / 2;
  });
  const receivablePocketCenter = await page
    .getByTestId('home-receivable-pocket')
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
  expect(Math.abs(walletIconCenter - receivablePocketCenter)).toBeLessThanOrEqual(1);

  const tabBar = page.getByRole('tablist');
  await expect(tabBar).toBeVisible();
  const tabBarPositioning = await tabBar.evaluate((element) => {
    const positions: string[] = [];
    let current: Element | null = element;
    while (current && positions.length < 4) {
      positions.push(getComputedStyle(current).position);
      current = current.parentElement;
    }
    return positions;
  });
  expect(tabBarPositioning).toContain('absolute');
  const tabBarGutters = await tabBar.evaluate((element) => {
    let floatingHost: Element | null = element;
    while (floatingHost && getComputedStyle(floatingHost).position !== 'absolute') {
      floatingHost = floatingHost.parentElement;
    }
    if (!floatingHost) return null;
    const rect = floatingHost.getBoundingClientRect();
    return {
      left: rect.left,
      right: document.documentElement.clientWidth - rect.right,
    };
  });
  expect(tabBarGutters).not.toBeNull();
  expect(Math.abs(tabBarGutters!.left - tabBarGutters!.right)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });

  await page.goto(`/expense/${e2eIds.expense}/items`);
  await expect(page.getByText('Ticket escaneado')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('ticket.png'), fullPage: true });

  await page.goto(`/expense/${e2eIds.expense}/participants`);
  await expect(page.getByText('Repartir productos')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('participants.png'), fullPage: true });

  await page.goto(`/expense/${e2eIds.expense}/status`);
  await expect(page.getByText('Cobros enviados')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('status.png'), fullPage: true });

  await page.goto('/activity');
  await expect(page.getByText('Actividad').first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('activity.png'), fullPage: true });

  await page.goto('/profile');
  await expect(page.getByText('Tu reputación')).toBeVisible();
  await expect(page.getByText('88')).toBeVisible();
  await settleVisual(page);
  await page.screenshot({ path: testInfo.outputPath('profile.png'), fullPage: true });

  await page.goto('/c/e2e-public-token');
  await expect(page.getByText('Enlace privado de cobro')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('public-claim.png'), fullPage: true });
});

function allocation(id: string, itemId: string, participantId: string, amountCents: number) {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-ccccccc${id}`,
    item_id: itemId,
    participant_id: participantId,
    method: 'equal',
    shares: null,
    percentage: null,
    units: null,
    amount_cents: amountCents,
  };
}

const receiptSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900">
  <rect width="720" height="900" fill="#dfc8aa"/>
  <rect x="126" y="34" width="468" height="832" rx="6" fill="#fffdfa"/>
  <g fill="#111827" font-family="monospace" text-anchor="middle">
    <text x="360" y="105" font-size="25" font-weight="700">PIZZERÍA BELLA NAPOLI</text>
    <text x="360" y="142" font-size="18">C/ Major, 12 · Barcelona</text>
    <text x="360" y="192" font-size="17">Ticket 012345 · 18/05/2024</text>
  </g>
  <line x1="168" y1="228" x2="552" y2="228" stroke="#98a2b3" stroke-dasharray="7 7"/>
  <g fill="#111827" font-family="monospace" font-size="20">
    <text x="170" y="280">Pizza</text><text x="470" y="280">12,00 €</text>
    <text x="170" y="330">Refresco</text><text x="470" y="330">3,50 €</text>
    <text x="170" y="380">Patatas</text><text x="470" y="380">4,20 €</text>
    <text x="170" y="430">Ensalada</text><text x="470" y="430">6,80 €</text>
    <text x="170" y="480">Tiramisú</text><text x="470" y="480">5,50 €</text>
    <text x="170" y="530">Café</text><text x="470" y="530">8,00 €</text>
  </g>
  <line x1="168" y1="580" x2="552" y2="580" stroke="#98a2b3" stroke-dasharray="7 7"/>
  <g fill="#111827" font-family="monospace" font-size="27" font-weight="700">
    <text x="170" y="640">TOTAL</text><text x="455" y="640">40,00 €</text>
  </g>
  <text x="360" y="720" fill="#667085" font-family="monospace" font-size="18" text-anchor="middle">¡Gracias por tu visita!</text>
</svg>`;
