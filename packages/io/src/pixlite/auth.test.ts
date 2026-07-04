import { describe, expect, it } from 'vitest';
import { authHash, EMPTY_PASSWORD_AUTH } from './auth';

describe('authHash', () => {
  it('computes the documented empty-password hash (doc §4.1)', () => {
    // The API doc's worked example for an empty password.
    expect(authHash('')).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
    expect(EMPTY_PASSWORD_AUTH).toBe('47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU');
  });

  it('emits Base64URL with no +, /, or padding', () => {
    const h = authHash('s3cret-password!');
    expect(h).not.toMatch(/[+/=]/);
    // Deterministic for a given password.
    expect(h).toBe(authHash('s3cret-password!'));
  });
});
