import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  displayNameSchema,
  emailSchema,
  loginSchema,
  passwordChecks,
  resetPasswordSchema,
  signUpSchema,
} from '@/lib/auth-validation';

describe('auth validation', () => {
  it('normalizes a valid email without altering the password', () => {
    expect(loginSchema.parse({ email: '  Persona@Example.COM ', password: '  Secret  ' })).toEqual({
      email: 'persona@example.com',
      password: '  Secret  ',
    });
  });

  it('rejects malformed and oversized email addresses', () => {
    expect(emailSchema.safeParse({ email: 'sin-arroba' }).success).toBe(false);
    expect(emailSchema.safeParse({ email: `${'a'.repeat(250)}@example.com` }).success).toBe(false);
  });

  it('requires a strong password and an exact confirmation', () => {
    expect(passwordChecks('ClaveSegura8')).toEqual({
      length: true,
      lowercase: true,
      uppercase: true,
      number: true,
    });
    expect(
      signUpSchema.safeParse({
        email: 'persona@example.com',
        password: 'demasiadodebil',
        passwordConfirmation: 'demasiadodebil',
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        password: 'ClaveSegura8',
        passwordConfirmation: 'ClaveSegura9',
      }).success,
    ).toBe(false);
  });

  it('accepts international display names but rejects control characters', () => {
    expect(displayNameSchema.parse('  María-José  ')).toBe('María-José');
    expect(displayNameSchema.safeParse('María\nAdmin').success).toBe(false);
  });

  it('maps sensitive errors without exposing account existence', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' }, 'login')).toBe(
      'El correo o la contraseña no son correctos.',
    );
    expect(authErrorMessage({ code: 'user_already_exists' }, 'signup')).not.toContain('ya existe');
    expect(authErrorMessage({ status: 429 }, 'password-reset')).toContain('demasiados intentos');
  });
});
