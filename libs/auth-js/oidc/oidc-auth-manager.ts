/* eslint-disable
    @typescript-eslint/no-non-null-assertion,
    @typescript-eslint/naming-convention,
    camelcase
*/

import { merge } from 'lodash-es';
import {
    type ErrorResponse, InMemoryWebStorage, type SigninSilentArgs, type User, type UserProfile, WebStorageStateStore
} from 'oidc-client-ts';

import {
    type AuthGuardOptions, AuthLogger, AuthManager, type AuthSubscriber, type AuthSubscriberOptions,
    type AuthSubscription, AuthSubscriptions, decodeJwt, getBaseUrl, isNativeMobile, isUrlMatching,
    stringToURL
} from '../core';
import { DEFAULT_SETTINGS, REDIRECT_URL_KEY } from './default-settings';
import { MobileStorage } from './mobile/mobile-storage';
import type { AccessToken } from './models/access-token.model';
import type { LoginArgs, LogoutArgs, RenewArgs } from './models/args.model';
import { DesktopNavigation } from './models/desktop-navigation.enum';
import type { IdToken } from './models/id-token.model';
import type { OIDCAuthSettings } from './models/oidc-auth-settings.model';
import type { UserSession } from './models/user-session.model';
import { OIDCAuthGuard } from './oidc-auth-guard';
import { OIDCAuthInterceptor } from './oidc-auth-interceptor';
import { OIDCUserManager } from './oidc-user-manager';

const logger = new AuthLogger('OIDCAuthManager');

export class OIDCAuthManager extends AuthManager<OIDCAuthSettings> {
    #userSubs = new AuthSubscriptions<User | null | undefined>();
    #idTokenSubs = new AuthSubscriptions<string | undefined>();
    #accessTokenSubs = new AuthSubscriptions<string | undefined>();
    #userProfileSubs = new AuthSubscriptions<UserProfile | undefined>();
    #userSessionSubs = new AuthSubscriptions<UserSession | undefined>();
    #authenticatedSubs = new AuthSubscriptions<boolean>();
    #renewingSubs = new AuthSubscriptions<boolean>();
    #redirectSubs = new AuthSubscriptions<URL>();
    #userManagerSubs: (() => void)[] = [];

    #idToken?: string;
    #accessToken?: string;
    #userProfile?: UserProfile;
    #userSession?: UserSession;
    #isAuthenticated = false;
    #isRenewing = false;
    #silentRenewDeferred = false;

    #userManager?: OIDCUserManager;
    #settings = DEFAULT_SETTINGS as OIDCAuthSettings;

    #user?: User | null;
    private set user(value: User | null | undefined) {
        if (this.#user !== value) {
            this.#user = value;

            this.#idToken = (value) ? value.id_token : undefined;
            this.#accessToken = (value) ? value.access_token : undefined;
            this.#userProfile = value?.profile ?? undefined;
            this.#userSession = (value) ? {
                expired: value.expired,
                expires_in: value.expires_in,
                expires_at: value.expires_at,
                token_type: value.token_type,
                scope: value.scope,
                scopes: value.scopes,
                session_state: value.session_state
            } : undefined;
            this.#isAuthenticated = !!(value && !value.expired);

            // Silent renew was deferred at construction (session not restored at startup):
            // start it now that a session is actually established. One-shot — the service
            // stays subscribed for the lifetime of the manager, exactly as if it had been
            // started by the UserManager ctor.
            if (this.#silentRenewDeferred && this.#isAuthenticated) {
                this.#silentRenewDeferred = false;
                this.#userManager?.startSilentRenew();
            }

            this.#userSubs.notify(this.#user);
            this.#idTokenSubs.notify(this.#idToken);
            this.#accessTokenSubs.notify(this.#accessToken);
            this.#userProfileSubs.notify(this.#userProfile);
            this.#userSessionSubs.notify(this.#userSession);
            this.#authenticatedSubs.notify(this.#isAuthenticated);
        }
    }

    // --- PUBLIC API(s) ---

    public async init(userSettings: OIDCAuthSettings): Promise<void> {
        AuthLogger.setLogLevel(userSettings.logLevel ?? DEFAULT_SETTINGS.logLevel);

        // Sanity checks
        const isNativeMobilePlatform = isNativeMobile();
        if (isNativeMobilePlatform && !userSettings.mobileScheme) {
            throw logger.getError('Parameter `mobileScheme` is required for mobile platform');
        }

        /**
         * Providers like Keycloak does not handle custom redirect urls like `demo-app://?oidc-callback=login`,
         * because they lack a host name. To fix this, `demo-app://localhost/?oidc-callback=login` is used instead.
         */
        const baseUrl = (isNativeMobilePlatform) ? `${userSettings.mobileScheme!}://localhost/` : getBaseUrl();

        // A consumer can inject its own persistent store via `secureStorage` (e.g. a chunking or AES
        // Capacitor wrapper on native). Otherwise the package falls back to its built-in store:
        // MobileStorage on native (Capacitor secure-storage / preferences / localStorage), in-memory
        // on web/desktop.
        const store = userSettings.secureStorage
            ?? ((isNativeMobilePlatform) ? new MobileStorage() : new InMemoryWebStorage());

        // Initialize settings
        this.#settings = merge({}, DEFAULT_SETTINGS, {
            internal: {
                userStore: new WebStorageStateStore({ store }),
                redirect_uri: `${baseUrl}${DEFAULT_SETTINGS.internal.redirect_uri}`,
                post_logout_redirect_uri: `${baseUrl}${DEFAULT_SETTINGS.internal.post_logout_redirect_uri}`,
                popup_redirect_uri: `${baseUrl}${DEFAULT_SETTINGS.internal.popup_redirect_uri}`,
                popup_post_logout_redirect_uri: `${baseUrl}${DEFAULT_SETTINGS.internal.popup_post_logout_redirect_uri}`,
                silent_redirect_uri: `${baseUrl}${DEFAULT_SETTINGS.internal.silent_redirect_uri}`
            }
        }, userSettings);

        // Make sure we are not trapped in the inception loop
        this.#assertNotInInceptionLoop();

        // A background renew loop must not run against a session the app has declared
        // not-restored (`retrieveUserSession: false` and no `loginRequired`): the UserManager
        // ctor would otherwise start SilentRenewService, which reads the persisted user straight
        // from the store — bypassing the "not restored" decision — and replays a possibly dead
        // (already-rotated) refresh token on the signin screen (`invalid_grant` loop). Defer
        // automatic silent renew until a session is actually established, then start it once
        // (see the `user` setter).
        this.#silentRenewDeferred = !!this.#settings.automaticSilentRenew
            && !this.#settings.retrieveUserSession
            && !this.#settings.loginRequired;

        // Configure the user manager
        this.#userManager = new OIDCUserManager(this.#silentRenewDeferred
            ? { ...this.#settings, automaticSilentRenew: false }
            : this.#settings);

        // Configure the interceptor
        if (this.#settings.automaticLoginOn401 || this.#settings.automaticInjectToken) {
            new OIDCAuthInterceptor(this, this.#userManager);
        }

        // Listen for events
        this.#userManagerSubs.push(
            this.#userManager.events.addUserLoaded(user => {
                this.user = user;
            }),
            this.#userManager.events.addUserUnloaded(() => {
                if (this.#user) {
                    this.user = null;
                    // If user is kicked out for any reason -> reload the app if login is required
                    if (this.#settings.loginRequired) {
                        location.reload();
                    }
                }
            }),
            this.#userManager.events.addSilentRenewError(async (error: Error) => {
                // Only wipe on a definitive renew failure (see #isDefinitiveRenewError). Transient
                // failures (offline, network, 5xx) must NOT destroy the stored session — it is the
                // single source of truth, so the next renew can recover.
                //
                // Caveat: preserving the session on a transient failure leaves the cached
                // `#isAuthenticated` stale-true until the next renew (nothing here reacts to the access
                // token actually expiring). That is safe for consumers running `loginRequired: false` +
                // `automaticLoginOn401: false` (they don't rely on this handler to force re-login and
                // handle 401s themselves) — the current consumers. A `loginRequired: true` /
                // `automaticLoginOn401: true` consumer using the built-in interceptor should first make
                // `#isAuthenticated` reflect token expiry (derive it live, or react to
                // `addAccessTokenExpired`) so a stale-true value can't suppress the 401 re-login.
                await this.#removeUserOnDefinitiveRenewError(error);
            })
        );

        // Decide what to do..
        if (isUrlMatching(location.href, this.#settings.internal?.redirect_uri)) {
            // Back from signin redirect
            await this.#runSyncOrAsync(async () => {
                const redirectUrl = sessionStorage.getItem(REDIRECT_URL_KEY);
                await this.#callSignin(() => this.#userManager!.signinRedirectCallback(location.href), redirectUrl);
                sessionStorage.removeItem(REDIRECT_URL_KEY);
            });
        } else if (isUrlMatching(location.href, this.#settings.internal?.post_logout_redirect_uri)) {
            // Back from signout redirect
            await this.#runSyncOrAsync(async () => {
                const redirectUrl = sessionStorage.getItem(REDIRECT_URL_KEY);
                await this.#callSignout(() => this.#userManager!.signoutRedirectCallback(location.href), redirectUrl);
                sessionStorage.removeItem(REDIRECT_URL_KEY);
            });
        } else if (this.#settings.retrieveUserSession || this.#settings.loginRequired) {
            // Try to load user from storage
            const user = await this.#userManager.getUser();
            if (!user || user.expired) {
                // on desktop -> try a silent renew with iframe
                if (!isNativeMobilePlatform && this.#settings.retrieveUserSession) {
                    await this.#runSyncOrAsync(() => this.#signinSilent()
                        .catch(async (signinSilentError: unknown) => {
                            const { error, message } = signinSilentError as ErrorResponse;
                            // Ex: login_required, consent_required, interaction_required, account_selection_required
                            if (this.#settings.loginRequired && (error?.includes('_required') || message.includes('_required'))) {
                                await this.login();
                            } else {
                                logger.warn('User\'s session cannot be retrieved:', message);
                                // Surface the signed-out state through the user setter: `user$`-style
                                // streams are fed solely by it, so leaving `user` unassigned here
                                // (e.g. after a transient failure that preserved the store) would
                                // mean late subscribers never receive any emission. Memory-only —
                                // the persisted session is NOT wiped.
                                this.user = null;
                                if (this.#settings.loginRequired) {
                                    throw signinSilentError;
                                }
                            }
                        }));
                // else -> force login if required
                } else if (this.#settings.loginRequired) {
                    await this.login();
                // else -> gracefully notify that we are not authenticated
                } else {
                    this.user = null;
                }
            } else {
                this.user = user;
            }
        } else {
            this.user = null;
        }
    }

    public async logout(args?: LogoutArgs): Promise<void> {
        const redirectUrl = args?.redirectUrl ?? location.href;
        const preserveStoredUser = args?.preserveStoredUser ?? false;
        if (isNativeMobile()) {
            await this.#callSignout(() => this.#userManager!.signoutMobile(args), redirectUrl, preserveStoredUser);
        } else {
            switch (args?.desktopNavigationType ?? this.#settings.desktopNavigationType) {
                case DesktopNavigation.POPUP:
                    await this.#callSignout(() => this.#userManager!.signoutPopup(args), redirectUrl, preserveStoredUser);
                    break;
                case DesktopNavigation.REDIRECT:
                default:
                    sessionStorage.setItem(REDIRECT_URL_KEY, redirectUrl);
                    await this.#userManager?.signoutRedirect(args);
                    break;
            }
        }
    }

    public async login(args?: LoginArgs): Promise<boolean> {
        const redirectUrl = args?.redirectUrl ?? location.href;
        if (isNativeMobile()) {
            await this.#callSignin(() => this.#userManager!.signinMobile(args), redirectUrl);
        } else {
            switch (args?.desktopNavigationType ?? this.#settings.desktopNavigationType) {
                case DesktopNavigation.POPUP:
                    await this.#callSignin(() => this.#userManager!.signinPopup(args), redirectUrl);
                    break;
                case DesktopNavigation.REDIRECT:
                default:
                    sessionStorage.setItem(REDIRECT_URL_KEY, redirectUrl);
                    await this.#userManager?.signinRedirect(args);
                    break;
            }
        }
        return (this.#isAuthenticated);
    }

    public async renew(args?: RenewArgs): Promise<void> {
        return this.#signinSilent(args).catch((error: unknown) => {
            logger.error(error);
        });
    }

    public getSettings(): OIDCAuthSettings {
        return this.#settings;
    }

    public isRenewing(): boolean {
        return this.#isRenewing;
    }

    public async isAuthenticated(): Promise<boolean> {
        await this.#waitForRenew('isAuthenticated()');
        return this.#isAuthenticated;
    }

    public async runGuard(toUrl: string, options?: AuthGuardOptions): Promise<string | boolean> {
        const authGuard = new OIDCAuthGuard(this);
        return authGuard.validate(toUrl, options);
    }

    public async getUser(): Promise<User | null | undefined> {
        await this.#waitForRenew('getUser()');
        return this.#user;
    }

    /**
     * Reads the user persisted in the OIDC store (as opposed to `getUser()`, which returns the
     * in-memory user). On native, `retrieveUserSession: false` leaves the in-memory user null at
     * cold start, so a caller (e.g. a biometric unlock) uses this to decide whether there is a
     * stored session to `renew()` from — without reaching into the internal store key. Returns
     * `null` when nothing is persisted (or when a legacy record can't be read back after a storage
     * migration), so callers can cleanly fall back to interactive login instead of triggering the
     * (native-unusable) silent-renew iframe on an empty store.
     * @returns The user persisted in the OIDC store, or `null` when none is stored (or readable).
     */
    public async getStoredUser(): Promise<User | null> {
        await this.#waitForRenew('getStoredUser()');
        return (await this.#userManager?.loadStoredUser()) ?? null;
    }

    public async storeUser(user: User): Promise<void> {
        await this.#userManager?.storeUser(user);
    }

    public async removeUser(): Promise<void> {
        await this.#removeUser();
    }

    public async getUserProfile(): Promise<UserProfile | undefined> {
        await this.#waitForRenew('getUserProfile()');
        return this.#userProfile;
    }

    public async getUserSession(): Promise<UserSession | undefined> {
        await this.#waitForRenew('getUserSession()');
        return this.#userSession;
    }

    public async getIdToken(): Promise<string | undefined> {
        await this.#waitForRenew('getIdToken()');
        return this.#idToken;
    }

    public async getIdTokenDecoded(): Promise<IdToken | string | undefined> {
        await this.#waitForRenew('getIdTokenDecoded()');
        return decodeJwt(this.#idToken) as IdToken | string | undefined;
    }

    public async getAccessToken(): Promise<string | undefined> {
        await this.#waitForRenew('getAccessToken()');
        return this.#accessToken;
    }

    public async getAccessTokenDecoded(): Promise<AccessToken | string | undefined> {
        await this.#waitForRenew('getAccessTokenDecoded()');
        return decodeJwt(this.#accessToken) as AccessToken | string | undefined;
    }

    // --- DESTROY ---

    public destroy(): void {
        this.#userSubs.unsubscribe();
        this.#idTokenSubs.unsubscribe();
        this.#accessTokenSubs.unsubscribe();
        this.#userProfileSubs.unsubscribe();
        this.#userSessionSubs.unsubscribe();
        this.#authenticatedSubs.unsubscribe();
        this.#renewingSubs.unsubscribe();
        this.#redirectSubs.unsubscribe();
        this.#userManagerSubs.forEach(unsub => {
            unsub();
        });
    }

    // --- HANDLER(s) ---

    public onUserChanged(handler: AuthSubscriber<User | null | undefined>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#userSubs.add(handler, options);
    }

    public onIdTokenChanged(handler: AuthSubscriber<string | undefined>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#idTokenSubs.add(handler, options);
    }

    public onAccessTokenChanged(handler: AuthSubscriber<string | undefined>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#accessTokenSubs.add(handler, options);
    }

    public onUserProfileChanged(handler: AuthSubscriber<UserProfile | undefined>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#userProfileSubs.add(handler, options);
    }

    public onUserSessionChanged(handler: AuthSubscriber<UserSession | undefined>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#userSessionSubs.add(handler, options);
    }

    public onAuthenticatedChanged(handler: AuthSubscriber<boolean>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#authenticatedSubs.add(handler, options);
    }

    public onRenewingChanged(handler: AuthSubscriber<boolean>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#renewingSubs.add(handler, options);
    }

    public onRedirect(handler: AuthSubscriber<URL>, options?: AuthSubscriberOptions): AuthSubscription {
        return this.#redirectSubs.add(handler, options);
    }

    // --- HELPER(s) ---

    /**
     * Makes sure that the execution code is not trapped in an infinite loop.
     * @example
     * 1) signinSilent or signinPopup was asked
     * 2) iframe or popup was created and navigation was made to OP
     * 3) redirection occurs in iframe or popup
     * 4) `silent_redirect_uri` or `popup_redirect_uri` is not found
     * 5) the web app (instead of the proper redirect_uri) is loaded in the iframe or popup
     * 6) an inception loop occurs -> app in iframe in iframe in iframe or popup in popup in popup..
     */
    #assertNotInInceptionLoop(): void {
        [this.#settings.internal?.silent_redirect_uri, this.#settings.internal?.popup_redirect_uri]
            .forEach(uri => {
                const htmlFileName = (new RegExp(/^.*\/(.*).html$/gm).exec(uri ?? ''))?.[1];
                const error = new Error(`${uri ?? 'redirect uri'} was not found.`);
                error.stack = undefined;

                if (isUrlMatching(location.href, uri)) {
                    logger.notif('ⓘ Encountered an error that usually means you forgot to include the redirect html files in your application assets.');
                    throw error;
                } else if (htmlFileName && location.href.includes(`/${htmlFileName}.html`)) {
                    logger.notif('ⓘ Encountered an error that usually means your redirect urls are misconfigured.');
                    throw error;
                }
            });
    }

    /**
     * Waits for a renew to finish or times out after 5s.
     * @param caller Name of the calling method, used in the timeout log message.
     * @example
     * 1) isNativeMobile = true + app is in background
     * 2) access token expires
     * 3) app is brought back to foreground
     * 4) addAccessTokenExpired event is called
     * 5) signinSilent is called
     * 6) in parallel user navigates somewhere and triggers isAuthenticated
     * 7) isAuthenticated should wait signinSilent to finish before returning
     */
    async #waitForRenew(caller: string): Promise<void> {
        const startTime = Date.now();
        // eslint-disable-next-line no-loops/no-loops
        while (this.#isRenewing) {
            if (Date.now() > (startTime + 5000)) {
                logger.error(`\`${caller}\``, 'timed out waiting for renew to finish.');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Triggers a re-login after a logout (if required).
     * @param redirectUrlAskedAfterLogout The redirect url that was requested along with the logout.
     * @example
     * 1) user is at http://my-app.com, logged-in and loginRequired=true
     * 2) user triggers a logout and gets redirected to '/'
     * 3) url did not changed, so no navigation occured and no guards either
     * 4) at this point, user is logged-out but still inside the app and able to see it
     */
    #postLogoutVerification(redirectUrlAskedAfterLogout: string | null): void {
        const postLogoutUrl = stringToURL(redirectUrlAskedAfterLogout ?? '/');
        if (this.#settings.loginRequired && (location.origin === postLogoutUrl.origin)) {
            location.reload();
        }
    }

    #notifyRenew(value: boolean): void {
        this.#isRenewing = value;
        this.#renewingSubs.notify(value);
    }

    async #runSyncOrAsync(job: () => Promise<unknown>): Promise<void> {
        if (this.#settings.loginRequired) {
            await job();
        } else {
            void job();
        }
    }

    async #redirect(url: string | null, error?: unknown): Promise<void> {
        if (error) {
            logger.error(error);
            await this.#removeUser();
        }

        const redirectUrl = stringToURL(url ?? '/');
        // History cannot be rewritten when origin is different
        if (location.origin === redirectUrl.origin) {
            history.replaceState(history.state, '', redirectUrl.href);
            this.#redirectSubs.notify(redirectUrl);
        } else {
            location.href = redirectUrl.href;
        }
    }

    async #removeUser(): Promise<void> {
        this.user = null;
        await Promise.all([
            this.#userManager?.clearStaleState(),
            this.#userManager?.removeUser()
        ]);
    }

    /**
     * True only for a definitive renew failure:
     * - `invalid_grant` — the token endpoint rejected the refresh token (consumed / rotated-away /
     *   revoked / expired token family);
     * - `login_required` / `consent_required` / `interaction_required` — the authorize endpoint
     *   (silent iframe path) demands user interaction, i.e. the OP session is gone and a silent
     *   renew can never recover on its own.
     * Network / timeout / 5xx failures return false so the persisted session is preserved for the
     * next renew instead of being eagerly wiped.
     * @param error The error thrown by a failed renew.
     * @returns Whether the error definitively ends the session.
     */
    #isDefinitiveRenewError(error: unknown): boolean {
        const code = (error as Partial<ErrorResponse> | undefined)?.error;
        return (code === 'invalid_grant') || (code === 'login_required')
            || (code === 'consent_required') || (code === 'interaction_required');
    }

    /**
     * Single wipe policy shared by both renew-failure sites — the `silentRenewError` event handler
     * (automatic renews) and `#signinSilent`'s catch (manual renews); each sees failures the other
     * doesn't, so both must apply the same rule.
     * @param error The error thrown by a failed renew.
     */
    async #removeUserOnDefinitiveRenewError(error: unknown): Promise<void> {
        if (this.#isDefinitiveRenewError(error)) {
            await this.#removeUser();
        }
    }

    async #signinSilent(args?: SigninSilentArgs): Promise<void> {
        this.#notifyRenew(true);

        try {
            await this.#userManager?.signinSilent(args);
        } catch (error) {
            // Wipe only on a definitive rejection (see #isDefinitiveRenewError). A transient
            // failure must leave the stored session intact so the next renew can recover —
            // critical now that the OIDC store is the single source of truth (no biometric copy).
            await this.#removeUserOnDefinitiveRenewError(error);
            throw error;
        } finally {
            this.#notifyRenew(false);
        }
    }

    async #callSignin(managerCall: () => Promise<unknown>, redirectUrl: string | null): Promise<void> {
        try {
            this.#notifyRenew(true);
            await managerCall().catch((err: unknown) => {
                const error = err as Error;
                if (error.message === 'Attempted to navigate on a disposed window') {
                    logger.notif('ⓘ Encountered an error that may be due to an ad blocker.');
                    error.stack = undefined;
                }
                throw error;
            });
            await this.#redirect(redirectUrl);
        } catch (error) {
            await this.#redirect('/', error);
            throw error;
        } finally {
            this.#notifyRenew(false);
        }
    }

    async #callSignout(managerCall: () => Promise<unknown>, redirectUrl: string | null, preserveStoredUser = false): Promise<void> {
        let preservedUser: User | null = null;
        try {
            if (preserveStoredUser) {
                // Preserve the persisted session across the sign-out: oidc-client's `_signoutStart`
                // wipes the user store internally (and `#removeUser` would wipe it again after), so
                // a snapshot is taken first and written back once the sign-out completes — the IDP
                // session is properly ended and the in-memory session cleared, but a gated re-entry
                // (e.g. biometric unlock -> `getStoredUser()` -> `renew()`) keeps working.
                //
                // Order matters:
                // 1) Stop the background renew loop BEFORE snapshotting — a pending silent-renew
                //    retry (armed by an offline timeout) survives `_events.unload()` and would
                //    otherwise renew off the restored session after the sign-out, silently
                //    re-authenticating with no gate. Re-arm the deferred-start flag so the next
                //    established session starts the loop again (see the `user` setter).
                // 2) Await any in-flight renew — snapshotting mid-rotation would capture an
                //    already-consumed refresh token and restore THAT (guaranteed `invalid_grant`
                //    + token-family revocation on its next use).
                this.#userManager?.stopSilentRenew();
                this.#silentRenewDeferred = !!this.#settings.automaticSilentRenew;
                await this.#userManager?.pendingRenew?.catch(() => null);
                preservedUser = (await this.#userManager?.loadStoredUser()) ?? null;
            }

            await managerCall().catch((err: unknown) => {
                const error = err as Error;
                if (error.message === 'Attempted to navigate on a disposed window') {
                    logger.notif('ⓘ Encountered an error that may be due to an ad blocker.');
                    error.stack = undefined;
                }
                throw error;
            });
            if (preservedUser) {
                // Restore before redirecting so the store is complete by the time the app
                // lands on its post-logout page (which may immediately probe the store).
                await this.#restorePreservedUser(preservedUser);
            }
            await this.#redirect(redirectUrl);
            if (preservedUser) {
                this.user = null;
            } else {
                await this.#removeUser();
            }
        } catch (error) {
            // Wipe first, then restore the snapshot (the sign-out failed — e.g. the user closed
            // the browser — so the store state is unknown), and only then notify redirect
            // subscribers: a post-logout page may probe the store as soon as the redirect lands.
            logger.error(error);
            await this.#removeUser();
            if (preservedUser) {
                await this.#restorePreservedUser(preservedUser);
            }
            redirectUrl = '/';
            await this.#redirect(redirectUrl);
            throw error;
        } finally {
            this.#postLogoutVerification(redirectUrl);
        }
    }

    /**
     * Best-effort write-back of the preserved session after a sign-out: a failing store write
     * must not turn a completed sign-out into an error (and must never shadow an original one).
     * @param user The session snapshot taken before the sign-out.
     */
    async #restorePreservedUser(user: User): Promise<void> {
        try {
            await this.#userManager?.storeUser(user);
        } catch (error) {
            logger.error('Failed to restore the preserved session after sign-out:', error);
        }
    }
}
