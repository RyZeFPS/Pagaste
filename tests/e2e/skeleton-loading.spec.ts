import { expect, test } from '@playwright/test';
import { createMockSupabase, installMockSupabase, signInFromUi } from './mock-supabase';

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

test('mantiene la composición mientras restaura sesión y carga los datos', async ({
  page,
  isMobile,
}, testInfo) => {
  test.skip(!isMobile, 'La carga visual se comprueba una vez con viewport móvil.');
  const backend = createMockSupabase(true);
  await installMockSupabase(page, backend, { restDelayMs: 650 });
  await signInFromUi(page);

  await page.reload();

  await expect(page.getByTestId('app-boot-skeleton')).toBeVisible();
  await expect(page.getByTestId('home-data-skeleton')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home-skeleton.png'), fullPage: true });
  await expect(page.getByTestId('home-data-skeleton')).toBeHidden();
  await expect(page.getByText('Cena del viernes')).toBeVisible();
  expect(backend.unhandledRequests).toEqual([]);
});
