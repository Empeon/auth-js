import type { User, UserProfile } from 'oidc-client-ts';

import type { AuthGuardOptions } from '../core';
import type { AccessToken } from './models/access-token.model';
import type { LoginArgs, LogoutArgs, RenewArgs } from './models/args.model';
import type { IdToken } from './models/id-token.model';
import type { OIDCAuthSettings } from './models/oidc-auth-settings.model';
import type { UserSession } from './models/user-session.model';
import type { OIDCAuthManager } from './oidc-auth-manager';

export abstract class OIDCAuthService<T extends OIDCAuthSettings = OIDCAuthSettings> {
    protected manager: OIDCAuthManager;

    public constructor(manager: OIDCAuthManager) {
        this.manager = manager;
    }

    /**
     * @param args Optional sign-in arguments (redirect url, navigation type, mobile window params).
     * @returns Whether the user is authenticated once the sign-in flow completes.
     * @see {@link OIDCAuthManager.login}
     */
    public async login(args?: LoginArgs): Promise<boolean> {
        return this.manager.login(args);
    }

    /**
     * @param args Optional sign-out arguments (redirect url, navigation type, mobile window params).
     * @returns A promise that resolves once the sign-out flow completes.
     * @see {@link OIDCAuthManager.logout}
     */
    public async logout(args?: LogoutArgs): Promise<void> {
        return this.manager.logout(args);
    }

    /**
     * @param args Optional renew arguments.
     * @returns A promise that resolves once the renew attempt completes.
     * @see {@link OIDCAuthManager.renew}
     */
    public async renew(args?: RenewArgs): Promise<void> {
        return this.manager.renew(args);
    }

    /**
     * @returns Whether a token renew is currently in progress.
     * @see {@link OIDCAuthManager.isRenewing}
     */
    public isRenewing(): boolean {
        return this.manager.isRenewing();
    }

    /**
     * @returns Whether the current user is authenticated.
     * @see {@link OIDCAuthManager.isAuthenticated}
     */
    public async isAuthenticated(): Promise<boolean> {
        return this.manager.isAuthenticated();
    }

    /**
     * @returns The settings the auth manager was initialized with.
     * @see {@link OIDCAuthManager.getSettings}
     */
    public getSettings(): T {
        return this.manager.getSettings() as T;
    }

    /**
     * @returns The in-memory user, or `null`/`undefined` when signed out.
     * @see {@link OIDCAuthManager.getUser}
     */
    public async getUser(): Promise<User | null | undefined> {
        return this.manager.getUser();
    }

    /**
     * @returns The user persisted in the OIDC store, or `null` when none is stored (or readable).
     * @see {@link OIDCAuthManager.getStoredUser}
     */
    public async getStoredUser(): Promise<User | null> {
        return this.manager.getStoredUser();
    }

    /**
     * @param user The user to persist in the OIDC store.
     * @returns A promise that resolves once the user is persisted.
     * @see {@link OIDCAuthManager.storeUser}
     */
    public async storeUser(user: User): Promise<void> {
        return this.manager.storeUser(user);
    }

    /**
     * @returns A promise that resolves once the user is removed from memory and the OIDC store.
     * @see {@link OIDCAuthManager.removeUser}
     */
    public async removeUser(): Promise<void> {
        return this.manager.removeUser();
    }

    /**
     * @returns The current user's profile claims, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getUserProfile}
     */
    public async getUserProfile(): Promise<UserProfile | undefined> {
        return this.manager.getUserProfile();
    }

    /**
     * @returns The current user's session info, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getUserSession}
     */
    public async getUserSession(): Promise<UserSession | undefined> {
        return this.manager.getUserSession();
    }

    /**
     * @returns The current id token, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getIdToken}
     */
    public async getIdToken(): Promise<string | undefined> {
        return this.manager.getIdToken();
    }

    /**
     * @returns The decoded id token, the raw string when it cannot be decoded, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getIdTokenDecoded}
     */
    public async getIdTokenDecoded(): Promise<IdToken | string | undefined> {
        return this.manager.getIdTokenDecoded();
    }

    /**
     * @returns The current access token, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getAccessToken}
     */
    public async getAccessToken(): Promise<string | undefined> {
        return this.manager.getAccessToken();
    }

    /**
     * @returns The decoded access token, the raw string when it cannot be decoded, or `undefined` when signed out.
     * @see {@link OIDCAuthManager.getAccessTokenDecoded}
     */
    public async getAccessTokenDecoded(): Promise<AccessToken | string | undefined> {
        return this.manager.getAccessTokenDecoded();
    }

    /**
     * @param toUrl The url being navigated to.
     * @param options Optional guard options (validator, not-allowed redirect url).
     * @returns Whether the navigation is allowed, or a url to redirect to instead.
     * @see {@link OIDCAuthManager.runGuard}
     */
    public async runGuard(toUrl: string, options?: AuthGuardOptions): Promise<string | boolean> {
        return this.manager.runGuard(toUrl, options);
    }
}
