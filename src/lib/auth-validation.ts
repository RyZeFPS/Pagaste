import { z } from 'zod';

export const AUTH_EMAIL_MAX_LENGTH = 254;
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

const email = z
  .string()
  .trim()
  .min(1, 'Introduce tu correo electrónico.')
  .max(AUTH_EMAIL_MAX_LENGTH, 'El correo es demasiado largo.')
  .email('Introduce un correo válido.')
  .transform((value) => value.toLowerCase());

const loginPassword = z
  .string()
  .min(1, 'Introduce tu contraseña.')
  .max(AUTH_PASSWORD_MAX_LENGTH, 'La contraseña es demasiado larga.');

export const passwordChecks = (password: string) => ({
  length: password.length >= AUTH_PASSWORD_MIN_LENGTH,
  lowercase: /\p{Ll}/u.test(password),
  uppercase: /\p{Lu}/u.test(password),
  number: /\p{N}/u.test(password),
});

export const strongPassword = z
  .string()
  .min(AUTH_PASSWORD_MIN_LENGTH, `Usa al menos ${AUTH_PASSWORD_MIN_LENGTH} caracteres.`)
  .max(AUTH_PASSWORD_MAX_LENGTH, 'La contraseña es demasiado larga.')
  .refine((value) => passwordChecks(value).lowercase, 'Añade una letra minúscula.')
  .refine((value) => passwordChecks(value).uppercase, 'Añade una letra mayúscula.')
  .refine((value) => passwordChecks(value).number, 'Añade un número.');

export const loginSchema = z.object({
  email,
  password: loginPassword,
});

export const signUpSchema = z
  .object({
    email,
    password: strongPassword,
    passwordConfirmation: z.string().min(1, 'Repite tu contraseña.'),
  })
  .superRefine(({ password, passwordConfirmation }, context) => {
    if (password !== passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'Las contraseñas no coinciden.',
      });
    }
  });

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    passwordConfirmation: z.string().min(1, 'Repite tu contraseña.'),
  })
  .superRefine(({ password, passwordConfirmation }, context) => {
    if (password !== passwordConfirmation) {
      context.addIssue({
        code: 'custom',
        path: ['passwordConfirmation'],
        message: 'Las contraseñas no coinciden.',
      });
    }
  });

export const emailSchema = z.object({ email });

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Escribe al menos 2 caracteres.')
  .max(60, 'El nombre no puede superar 60 caracteres.')
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'El nombre contiene caracteres no válidos.');

export type AuthAction = 'login' | 'signup' | 'password-reset' | 'password-update';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

export function authErrorMessage(error: unknown, action: AuthAction): string {
  const candidate = (typeof error === 'object' && error ? error : {}) as ErrorLike;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;

  if (code === 'invalid_credentials') return 'El correo o la contraseña no son correctos.';
  if (code === 'email_not_confirmed') {
    return 'Confirma tu correo antes de iniciar sesión.';
  }
  if (code === 'weak_password') {
    return 'La contraseña no cumple los requisitos de seguridad.';
  }
  if (code === 'same_password') return 'Elige una contraseña diferente a la anterior.';
  if (code === 'signup_disabled') return 'El registro no está disponible en este momento.';
  if (code === 'captcha_failed') return 'No hemos podido completar la comprobación de seguridad.';
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    code === 'request_timeout' ||
    status === 429
  ) {
    return 'Has realizado demasiados intentos. Espera unos minutos antes de volver a probar.';
  }
  if (code === 'email_address_invalid') return 'Introduce un correo válido.';
  if (code === 'email_address_not_authorized') {
    return 'El servicio de correo todavía no está preparado para enviar a esta dirección.';
  }
  if (code === 'user_already_exists' && action === 'signup') {
    return 'No hemos podido crear la cuenta. Prueba a iniciar sesión o recuperar la contraseña.';
  }
  if (code === 'session_expired' || code === 'session_not_found') {
    return 'El enlace ha caducado. Solicita uno nuevo.';
  }

  if (action === 'login')
    return 'No hemos podido iniciar sesión. Revisa los datos e inténtalo de nuevo.';
  if (action === 'signup') return 'No hemos podido crear la cuenta. Inténtalo de nuevo.';
  if (action === 'password-reset') {
    return 'No hemos podido enviar las instrucciones. Inténtalo de nuevo más tarde.';
  }
  return 'No hemos podido guardar la nueva contraseña. Solicita otro enlace.';
}
