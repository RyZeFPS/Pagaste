import { z } from 'zod';
import { translate } from '@/i18n/core';
import type { Locale } from '@/i18n/translations';

export const AUTH_EMAIL_MAX_LENGTH = 254;
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 128;

export const passwordChecks = (password: string) => ({
  length: password.length >= AUTH_PASSWORD_MIN_LENGTH,
  lowercase: /\p{Ll}/u.test(password),
  uppercase: /\p{Lu}/u.test(password),
  number: /\p{N}/u.test(password),
});

export function createAuthValidationSchemas(locale: Locale) {
  const message = (
    key: Parameters<typeof translate>[1],
    values?: Parameters<typeof translate>[2],
  ) => translate(locale, key, values);

  const email = z
    .string()
    .trim()
    .min(1, message('auth.validationEmailRequired'))
    .max(AUTH_EMAIL_MAX_LENGTH, message('auth.validationEmailTooLong'))
    .email(message('auth.validationEmailInvalid'))
    .transform((value) => value.toLowerCase());

  const loginPassword = z
    .string()
    .min(1, message('auth.validationPasswordRequired'))
    .max(AUTH_PASSWORD_MAX_LENGTH, message('auth.validationPasswordTooLong'));

  const strongPassword = z
    .string()
    .min(
      AUTH_PASSWORD_MIN_LENGTH,
      message('auth.validationPasswordMin', { count: AUTH_PASSWORD_MIN_LENGTH }),
    )
    .max(AUTH_PASSWORD_MAX_LENGTH, message('auth.validationPasswordTooLong'))
    .refine((value) => passwordChecks(value).lowercase, message('auth.validationPasswordLowercase'))
    .refine((value) => passwordChecks(value).uppercase, message('auth.validationPasswordUppercase'))
    .refine((value) => passwordChecks(value).number, message('auth.validationPasswordNumber'));

  const passwordPair = z
    .object({
      password: strongPassword,
      passwordConfirmation: z.string().min(1, message('auth.validationPasswordRepeat')),
    })
    .superRefine(({ password, passwordConfirmation }, context) => {
      if (password !== passwordConfirmation) {
        context.addIssue({
          code: 'custom',
          path: ['passwordConfirmation'],
          message: message('auth.validationPasswordMismatch'),
        });
      }
    });

  return {
    emailSchema: z.object({ email }),
    loginSchema: z.object({ email, password: loginPassword }),
    signUpSchema: passwordPair.safeExtend({ email }),
    resetPasswordSchema: passwordPair,
    strongPassword,
    displayNameSchema: z
      .string()
      .trim()
      .min(2, message('auth.validationNameMin'))
      .max(60, message('auth.validationNameMax'))
      .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), message('auth.validationNameInvalid')),
  };
}

const spanishSchemas = createAuthValidationSchemas('es');

export const {
  displayNameSchema,
  emailSchema,
  loginSchema,
  resetPasswordSchema,
  signUpSchema,
  strongPassword,
} = spanishSchemas;

export type AuthAction = 'login' | 'signup' | 'password-reset' | 'password-update';

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

export function authErrorMessage(
  error: unknown,
  action: AuthAction,
  locale: Locale = 'es',
): string {
  const candidate = (typeof error === 'object' && error ? error : {}) as ErrorLike;
  const code = typeof candidate.code === 'string' ? candidate.code : '';
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  const message = (key: Parameters<typeof translate>[1]) => translate(locale, key);

  if (code === 'invalid_credentials') return message('auth.errorInvalidCredentials');
  if (code === 'email_not_confirmed') {
    return message('auth.errorEmailNotConfirmed');
  }
  if (code === 'weak_password') {
    return message('auth.errorWeakPassword');
  }
  if (code === 'same_password') return message('auth.errorSamePassword');
  if (code === 'signup_disabled') return message('auth.errorSignUpDisabled');
  if (code === 'captcha_failed') return message('auth.errorCaptcha');
  if (
    code === 'over_email_send_rate_limit' ||
    code === 'over_request_rate_limit' ||
    code === 'request_timeout' ||
    status === 429
  ) {
    return message('auth.errorRateLimit');
  }
  if (code === 'email_address_invalid') return message('auth.validationEmailInvalid');
  if (code === 'email_address_not_authorized') {
    return message('auth.errorEmailUnauthorized');
  }
  if (code === 'user_already_exists' && action === 'signup') {
    return message('auth.errorUserExists');
  }
  if (code === 'session_expired' || code === 'session_not_found') {
    return message('auth.errorSessionExpired');
  }

  if (action === 'login') return message('auth.errorLogin');
  if (action === 'signup') return message('auth.errorSignUp');
  if (action === 'password-reset') return message('auth.errorPasswordReset');
  return message('auth.errorPasswordUpdate');
}
