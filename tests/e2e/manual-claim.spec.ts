import { expect, test } from '@playwright/test';
import { createMockSupabase, e2eIds, installMockSupabase, signInFromUi } from './mock-supabase';

test('merchant picker recognizes and selects a known shop', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);

  await signInFromUi(page);
  await page.getByRole('button', { name: 'Añadir gasto manualmente' }).click();
  await page.getByTestId('expense-merchant').fill('merca');
  await expect(page.getByTestId('merchant-suggestion-mercadona')).toBeVisible();
  const logo = page
    .getByTestId('merchant-suggestion-mercadona')
    .getByTestId('merchant-logo-mercadona');
  await expect(logo).toBeVisible();
  await expect
    .poll(() =>
      logo.evaluate((element) => {
        const image = element.querySelector('img');
        return Boolean(image?.complete && image.naturalWidth > 0);
      }),
    )
    .toBe(true);
  await page.getByTestId('merchant-suggestion-mercadona').click();

  await expect(page.getByTestId('expense-merchant')).toHaveValue('Mercadona');
  await expect(page.getByTestId('merchant-selected-brand')).toContainText('Supermercado');
});

test('priority merchant suggestions use bundled full-colour brand assets', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);
  await signInFromUi(page);
  await page.getByRole('button', { name: 'Añadir gasto manualmente' }).click();

  for (const [name, id] of [
    ['Mercadona', 'mercadona'],
    ['Alcampo', 'alcampo'],
    ['DIA', 'dia'],
    ['Froiz', 'froiz'],
    ['Lidl', 'lidl'],
    ['Repsol', 'repsol'],
  ] as const) {
    await page.getByTestId('expense-merchant').fill(name);
    const suggestion = page.getByTestId(`merchant-suggestion-${id}`);
    await expect(suggestion).toBeVisible();
    const brandLogo = suggestion.getByTestId(`merchant-logo-${id}`);
    await expect
      .poll(() =>
        brandLogo.evaluate((element) => {
          const image = element.querySelector('img');
          if (!image?.complete || image.naturalWidth <= 0) return false;
          return (
            new URL(image.currentSrc || image.src, window.location.href).origin === location.origin
          );
        }),
      )
      .toBe(true);
  }
});

test('login, manual expense, external payment and receiver records it as received', async ({
  browser,
  context,
  page,
}) => {
  const backend = createMockSupabase();
  backend.profile.payment_phone_e164 = '+34600111222';
  backend.profile.share_payment_phone = true;
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installMockSupabase(page, backend);

  await signInFromUi(page);
  await page.getByRole('button', { name: 'Añadir gasto manualmente' }).click();
  await page.getByTestId('expense-title').fill('Cena del viernes');
  await page.getByTestId('expense-total').fill('40,00');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();

  await expect(page).toHaveURL(new RegExp(`/expense/${e2eIds.expense}/participants`));
  await page.getByTestId('participant-name').fill('Ferran');
  await page.getByTestId('add-participant').click();
  await expect(page.getByText('Repartir productos', { exact: true })).toBeVisible();
  await expect(page.getByText('Reparto igual preparado')).toBeVisible();
  await expect(page.getByTestId('review-expense')).toBeEnabled();
  expect(backend.allocations).toHaveLength(2);
  expect(
    backend.allocations.every(({ method, shares }) => method === 'equal' && shares === null),
  ).toBe(true);

  await page.getByTestId('review-expense').click();
  await expect(page.getByText('A recuperar')).toBeVisible();
  await page.getByTestId('send-claims').click();

  await expect(page.getByText('Solicitudes listas')).toBeVisible();
  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(page.getByRole('button', { name: 'Enlace copiado' })).toBeVisible();
  expect(backend.claims).toHaveLength(1);
  expect(backend.claims[0].amount_cents).toBe(2_000);
  expect(backend.claims[0].status).toBe('pending');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await guestContext.grantPermissions(['clipboard-read', 'clipboard-write']);
  const guestPage = await guestContext.newPage();
  await installMockSupabase(guestPage, backend);
  await guestPage.goto('/c/e2e-public-token');

  await expect(guestPage.getByText('Enlace privado de cobro')).toBeVisible();
  await expect(guestPage.getByText('Debes pagar a')).toBeVisible();
  await expect(guestPage.getByText('Alex', { exact: true })).toBeVisible();
  await expect(guestPage.getByText('+34600111222', { exact: true })).toBeVisible();
  await expect(guestPage.getByText('Tu parte de Cena del viernes')).toBeVisible();
  await expect(guestPage.getByText('Cómo se calcula')).toBeVisible();
  await expect(
    guestPage.getByText('Pagaste no procesa, ejecuta ni verifica el pago.'),
  ).toBeVisible();
  await expect(
    guestPage.getByText(/no tienes que pulsar «Ya he pagado» ni volver a Pagaste/u),
  ).toBeVisible();
  await expect(guestPage.getByRole('button', { name: 'Ya he pagado', exact: true })).toHaveCount(0);
  await expect(guestPage.getByText('Concepto', { exact: true })).toHaveCount(0);
  await guestPage.getByRole('button', { name: 'Copiar', exact: true }).first().click();
  await expect(guestPage.getByText('Importe copiado.')).toBeVisible();
  expect(backend.claims[0].viewed_at).toBe('2026-07-22T10:00:00.000Z');
  expect(backend.claims[0].status).toBe('pending');
  await guestContext.close();

  await page.goto(`/expense/${e2eIds.expense}/status`);
  await expect(page.getByText('Pendiente', { exact: true })).toBeVisible();
  await page.getByTestId('mark-claim-received').click();
  await expect(page.getByText('Recibido', { exact: true })).toBeVisible();
  await expect(page.getByText(/20,00\s*€/)).toBeVisible();
  expect(backend.claims[0].status).toBe('received');
  expect(backend.claims[0].received_by_user_id).toBe(e2eIds.user);
  expect(backend.unhandledRequests).toEqual([]);
});

test('manual products are added from the split screen and stay balanced', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);

  await signInFromUi(page);
  await page.getByRole('button', { name: 'Añadir gasto manualmente' }).click();
  await page.getByTestId('expense-title').fill('Comida de equipo');
  await page.getByTestId('expense-total').fill('12,00');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await page.getByTestId('participant-name').fill('Ferran');
  await page.getByTestId('add-participant').click();

  await page.getByRole('button', { name: 'Añadir producto' }).click();
  await page.getByTestId('split-item-name').fill('Pizza');
  await page.getByTestId('split-item-amount').fill('7,00');
  await page.getByTestId('split-add-item').click();

  await expect(page.getByText('Pizza', { exact: true })).toBeVisible();
  await expect(page.getByText(/5[,.]00 sin productos/u)).toBeVisible();
  expect(backend.items.map(({ line_total_cents }) => line_total_cents).sort()).toEqual([500, 700]);
  expect(backend.allocations).toHaveLength(4);
  expect(
    backend.allocations.every(({ method, shares }) => method === 'equal' && shares === null),
  ).toBe(true);
  expect(
    backend.allocations.reduce((total, allocation) => total + allocation.amount_cents, 0),
  ).toBe(1_200);
  expect(backend.unhandledRequests).toEqual([]);
});
