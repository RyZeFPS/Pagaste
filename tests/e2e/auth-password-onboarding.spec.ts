import { expect, test } from '@playwright/test';
import { createMockSupabase, installMockSupabase } from './mock-supabase';

test.use({ locale: 'es-ES', timezoneId: 'Europe/Madrid' });

test('el acceso por contraseña expone etiquetas y errores accesibles', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);
  await page.goto('/');

  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mostrar contraseña' })).toBeVisible();

  await page.getByTestId('login-email').fill('correo-no-valido');
  await page.getByTestId('login-submit').click();

  await expect(page.getByText('Introduce un correo válido.')).toBeVisible();
  await expect(page.getByText('Introduce tu contraseña.')).toBeVisible();
  await expect(page.getByTestId('login-email')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByTestId('login-password')).toHaveAttribute(
    'aria-describedby',
    'login-password-error',
  );
  await expect(page.locator('#login-password-error')).toHaveText('Introduce tu contraseña.');
});

test('el registro valida la contraseña y muestra una confirmación neutral', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);
  await page.goto('/signup');

  await page.getByTestId('signup-email').fill('nueva@example.com');
  await page.getByTestId('signup-password').fill('ClaveSegura8');
  await page.getByTestId('signup-password-confirmation').fill('OtraClave9');
  await page.getByTestId('signup-submit').click();
  await expect(page.getByText('Las contraseñas no coinciden.')).toBeVisible();

  await page.getByTestId('signup-password-confirmation').fill('ClaveSegura8');
  await page.getByTestId('signup-submit').click();
  await expect(page.getByText('Confirma tu correo')).toBeVisible();
  await expect(page.getByText('nueva@example.com')).toBeVisible();
});

test('la guía aparece una vez y completa el perfil al terminar', async ({ page }) => {
  const backend = createMockSupabase();
  backend.profile.onboarding_completed = false;
  await installMockSupabase(page, backend);
  await page.goto('/');

  await page.getByTestId('login-email').fill('alex@example.com');
  await page.getByTestId('login-password').fill('ClaveSegura8');
  await page.getByTestId('login-submit').click();

  await expect(page.getByText('¿Cómo te llamas?')).toBeVisible();
  await page.getByTestId('onboarding-name').fill('Álex');
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByText('Escanea o añade el gasto')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByText('Reparte con claridad')).toBeVisible();
  await page.getByTestId('onboarding-next').click();
  await expect(page.getByText('Comparte y confirma lo recibido')).toBeVisible();
  await page.getByTestId('onboarding-finish').click();

  await expect(page.getByTestId('new-expense')).toBeVisible();
  expect(backend.profile.onboarding_completed).toBe(true);

  await page.reload();
  await expect(page.getByTestId('new-expense')).toBeVisible();
  await expect(page.getByText('¿Cómo te llamas?')).toHaveCount(0);
});

test('la recuperación valida un token de un solo uso antes de permitir el cambio', async ({
  page,
}) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);

  await page.goto('/auth/confirm?token_hash=e2e-recovery-token&type=recovery');
  await expect(page.getByText('Protege tu cuenta')).toBeVisible();
  await expect(page.getByLabel('Contraseña nueva')).toBeVisible();
  expect(backend.unhandledRequests).toEqual([]);
});

test('un callback incompleto no crea una sesión', async ({ page }) => {
  const backend = createMockSupabase();
  await installMockSupabase(page, backend);

  await page.goto('/auth/confirm?type=recovery');
  await expect(page.getByRole('alert')).toContainText('El enlace no es válido');
  await expect(page.getByText('Protege tu cuenta')).toHaveCount(0);
  expect(backend.unhandledRequests).toEqual([]);
});
