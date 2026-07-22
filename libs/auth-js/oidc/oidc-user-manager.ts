/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/naming-convention, camelcase */

import { type SigninSilentArgs, type User, UserManager, type UserManagerSettings } from 'oidc-client-ts';

import { MobileNavigator } from './mobile/mobile-navigator';
import type { SigninMobileArgs, SignoutMobileArgs } from './models/args.model';
import type { OIDCAuthSettings } from './models/oidc-auth-settings.model';

/**
 * UserManager class that adds helpers and mobile capabilities
 * (ex: signinMobile, signoutMobile, MobileNavigator, MobileWindow)
 * @internal
 */
export class OIDCUserManager extends UserManager {
    #mobileNavigator!: MobileNavigator;
    #renewPromise: Promise<User | null> | null = null;

    /**
     * The in-flight silent renew, if any (`null` otherwise). Exposed so flows that must not run
     * concurrently with a token rotation — e.g. snapshotting the stored session during
     * `logout({ preserveStoredUser: true })` — can await its settlement first, instead of
     * capturing a mid-rotation (about-to-be-consumed) refresh token.
     * @returns The pending renew promise, or `null` when no renew is in flight.
     */
    public get pendingRenew(): Promise<User | null> | null {
        return this.#renewPromise;
    }

    public constructor(
        public libSettings: OIDCAuthSettings
    ) {
        super({
            authority: libSettings.authorityUrl,
            client_id: libSettings.clientId,
            scope: libSettings.scope,
            loadUserInfo: libSettings.loadUserInfo,
            automaticSilentRenew: libSettings.automaticSilentRenew,
            ...libSettings.internal
        } as UserManagerSettings);

        this.#mobileNavigator = new MobileNavigator();
    }

    /**
     * Single-flight guard around silent renew.
     *
     * With refresh-token rotation (RefreshTokenUsage.OneTimeOnly) a second refresh
     * issued in parallel reuses an already-rotated token, which the OP treats as reuse
     * -> `invalid_grant` and revocation of the whole token family. Both the
     * `automaticSilentRenew` timer (SilentRenewService calls `signinSilent` here
     * directly) and every manual `renew()` (via OIDCAuthManager) funnel through this
     * method, so coalescing concurrent calls onto one in-flight request closes the race
     * for all callers (e.g. the biometric auto-login racing the token-expiry timer).
     *
     * Concurrent callers intentionally share the in-flight request (and thus the first
     * caller's `args`): under rotation two refreshes cannot run in parallel regardless
     * of args, so a renew must never start a second token request while one is pending.
     * Callers needing distinct token params must await the current renew first. (In
     * practice `renew()` is always called with no args.)
     * @param args Optional silent sign-in arguments (shared by concurrent callers, see above).
     * @returns The renewed user, or `null` when the renew yields none.
     */
    public override async signinSilent(args?: SigninSilentArgs): Promise<User | null> {
        if (this.#renewPromise) {
            return this.#renewPromise;
        }
        this.#renewPromise = (async (): Promise<User | null> => {
            try {
                return await super.signinSilent(args);
            } finally {
                this.#renewPromise = null;
            }
        })();
        return this.#renewPromise;
    }

    /**
     * Pure store read: loads the persisted user WITHOUT the side effects of `getUser()`.
     * `getUser()` calls `_events.load(user, false)`, whose `super.load(user)` schedules the
     * access-token-expiring timer (→ a background `signinSilent`) even with `raiseEvent = false`.
     * On native (`retrieveUserSession: false`) we deliberately avoid arming that at cold start, so
     * callers that only want to *check* for a stored session (e.g. biometric unlock) use this.
     * @returns The user persisted in the OIDC store, or `null` when none is stored (or readable).
     */
    public async loadStoredUser(): Promise<User | null> {
        try {
            return await this._loadUser();
        } catch (error) {
            // A corrupt / legacy / unreadable record must degrade to "no stored session" (the
            // contract callers rely on for a clean interactive-login fallback), never a rejection.
            this._logger.create('loadStoredUser').warn('stored user could not be read, treating as none:', error);
            return null;
        }
    }

    /* public async readRequestTypeFromState(url = location.href): Promise<string | null> {
        const parsedUrl = new URL(url, location.origin);
        const params = parsedUrl[this.settings.response_mode === 'fragment' ? 'hash' : 'search'];
        const stateParam = new URLSearchParams(params.slice(1)).get('state');
        if (stateParam) {
            const storedStateString = await this.settings.stateStore.get(stateParam);
            if (storedStateString) {
                const state = JSON.parse(storedStateString) as { request_type: string };
                return state.request_type;
            }
        }
        return null;
    }*/

    public async signoutMobile(args: SignoutMobileArgs = {}): Promise<void> {
        const logger = this._logger.create('signout');

        const {
            mobileWindowToolbarColor,
            mobileWindowPresentationStyle,
            mobileWindowWidth,
            mobileWindowHeight,
            ...requestArgs
        } = args;

        const params = {
            mobileWindowToolbarColor: mobileWindowToolbarColor ?? this.libSettings.internal?.mobileWindowToolbarColor,
            mobileWindowPresentationStyle: mobileWindowPresentationStyle ?? this.libSettings.internal?.mobileWindowPresentationStyle,
            mobileWindowWidth: mobileWindowWidth ?? this.libSettings.internal?.mobileWindowWidth,
            mobileWindowHeight: mobileWindowHeight ?? this.libSettings.internal?.mobileWindowHeight
        };

        const handle = this.#mobileNavigator.prepare(this.settings.post_logout_redirect_uri!, params);

        await this._signout({
            request_type: 'so:m',
            post_logout_redirect_uri: this.settings.post_logout_redirect_uri,
            ...requestArgs
        }, handle);

        logger.info('success');
    }

    public async signinMobile(args: SigninMobileArgs = {}): Promise<void> {
        const logger = this._logger.create('signin');

        const {
            mobileWindowToolbarColor,
            mobileWindowPresentationStyle,
            mobileWindowWidth,
            mobileWindowHeight,
            ...requestArgs
        } = args;

        const params = {
            mobileWindowToolbarColor: mobileWindowToolbarColor ?? this.libSettings.internal?.mobileWindowToolbarColor,
            mobileWindowPresentationStyle: mobileWindowPresentationStyle ?? this.libSettings.internal?.mobileWindowPresentationStyle,
            mobileWindowWidth: mobileWindowWidth ?? this.libSettings.internal?.mobileWindowWidth,
            mobileWindowHeight: mobileWindowHeight ?? this.libSettings.internal?.mobileWindowHeight
        };

        const handle = this.#mobileNavigator.prepare(this.settings.redirect_uri, params);

        const user = await this._signin({
            request_type: 'si:m',
            redirect_uri: this.settings.redirect_uri,
            ...requestArgs
        }, handle);

        if (user.profile.sub) {
            logger.info('success, signed in subject', user.profile.sub);
        } else {
            logger.info('no subject');
        }
    }
}
