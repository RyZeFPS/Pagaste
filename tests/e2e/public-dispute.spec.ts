import { expect, test } from '@playwright/test';
import { createMockSupabase, e2eIds, installMockSupabase, signInFromUi } from './mock-supabase';

test('a guest disputes only their claim and the owner sees it', async ({ browser, page }) => {
  const backend = createMockSupabase(true);
  await installMockSupabase(page, backend);

  await page.goto('/c/e2e-public-token');
  await expect(page.getByText('Debes pagar a')).toBeVisible();
  await expect(page.getByText('Alex', { exact: true })).toBeVisible();
  await expect(page.getByText('Ferran')).toHaveCount(0);
  await page.getByRole('button', { name: 'Hay un error en el reparto', exact: true }).click();
  await expect(page.getByText('Cuéntanos qué no cuadra')).toBeVisible();
  await page.getByRole('button', { name: 'No consumí esto' }).click();
  await page.getByLabel('Explicación opcional').fill('No pedí este producto');
  await page.getByRole('button', { name: 'Enviar para revisión' }).click();
  await expect(page.getByText('Hemos avisado para que revise el reparto.')).toBeVisible();
  expect(backend.claims[0].status).toBe('disputed');

  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ownerPage = await ownerContext.newPage();
  await installMockSupabase(ownerPage, backend);
  await signInFromUi(ownerPage);
  await ownerPage.goto(`/expense/${e2eIds.expense}/status`);
  await expect(ownerPage.getByText('En revisión', { exact: true })).toBeVisible();
  await expect(ownerPage.getByTestId('mark-claim-received')).toHaveCount(0);
  expect(backend.unhandledRequests).toEqual([]);
  await ownerContext.close();
});
