import type { AsyncStorage } from 'oidc-client-ts';

/**
 * Contract for a store that persists the OIDC session (incl. the refresh token). Structurally an
 * oidc-client-ts `AsyncStorage` (async `getItem`/`setItem`/`removeItem`/`key`/`length`/`clear`);
 * a consumer app implements it to inject a custom platform store via
 * {@link OIDCAuthSettings.secureStorage} (e.g. a chunking or AES Capacitor secure-storage wrapper).
 */
export type SecureStorage = AsyncStorage;
