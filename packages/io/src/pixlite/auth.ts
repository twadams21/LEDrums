import { createHash } from 'node:crypto';

/**
 * Password → auth query-param hash (doc §4.1).
 *
 * `auth = Base64URL(SHA256(password))` with padding omitted (the controller
 * accepts an omitted final pad char and does NOT percent-decode). The empty
 * password yields the well-known `47DEQpj8HBSa-_TImW-5JCeuQeRkm5NMpJWZG3hSuFU`,
 * which authenticates the default password-less controller.
 */
export function authHash(password: string): string {
  return createHash('sha256')
    .update(password, 'utf8')
    .digest('base64url'); // base64url already strips '+'/'/' and padding
}

/** The auth hash for an empty password — the unauthenticated default. */
export const EMPTY_PASSWORD_AUTH = authHash('');
