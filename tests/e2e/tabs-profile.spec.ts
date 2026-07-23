import { expect, test } from '@playwright/test';
import { createMockSupabase, installMockSupabase, signInFromUi } from './mock-supabase';

test('the shared tab indicator moves in both directions', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);
  await signInFromUi(page);

  const indicator = page.getByTestId('tab-selection-indicator');
  await expect(indicator).toBeVisible();
  const homeX = (await indicator.boundingBox())!.x;

  await page.getByRole('tab', { name: 'Abrir perfil' }).click();
  await expect.poll(async () => (await indicator.boundingBox())!.x).toBeGreaterThan(homeX + 2);
  const profileX = (await indicator.boundingBox())!.x;
  expect(profileX).toBeGreaterThan(homeX + 2);

  await page.getByRole('tab', { name: 'Grupos' }).click();
  await expect.poll(async () => (await indicator.boundingBox())!.x).toBeLessThan(profileX - 2);
  const groupsX = (await indicator.boundingBox())!.x;
  expect(groupsX).toBeLessThan(profileX - 2);
});

test('profile opens the dedicated settings screen', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);
  await signInFromUi(page);
  await page.goto('/profile');

  const settingsButton = page.getByRole('button', { name: 'Abrir ajustes' });
  const settingsBox = await settingsButton.boundingBox();
  const titleBox = await page.getByText('Perfil', { exact: true }).first().boundingBox();
  expect(settingsBox).not.toBeNull();
  expect(titleBox).not.toBeNull();
  expect(settingsBox!.x).toBeGreaterThan(titleBox!.x);

  await settingsButton.click();
  await expect(page).toHaveURL(/\/settings\/?$/u);
  await expect(page.getByText('Cuenta y datos')).toBeVisible();
  await expect(page.getByText('Notificaciones')).toBeVisible();
  await expect(page.getByText('Privacidad', { exact: true })).toBeVisible();
  await expect(page.getByText('Plan de Pagaste')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeVisible();
});
