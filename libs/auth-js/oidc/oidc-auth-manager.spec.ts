/* eslint-disable @typescript-eslint/naming-convention, camelcase */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { User } from 'oidc-client-ts';

import type { OIDCAuthSettings } from './models/oidc-auth-settings.model';

jest.mock('./oidc-user-manager', () => {
    // Store-backed mock: `storedUser` mimics the persisted OIDC record. `signoutPopup` wipes it
    // (like oidc-client's `_signoutStart` does internally), `storeUser`/`removeUser` write/clear
    // it — so restore-ordering regressions fail the preserve tests instead of staying green.
    const state = {
        ctorSettings: [] as OIDCAuthSettings[],
        userLoadedHandler: undefined as ((user: unknown) => void) | undefined,
        silentRenewErrorHandler: undefined as ((error: Error) => Promise<void>) | undefined,
        storedUser: null as unknown,
        pendingRenew: null as Promise<unknown> | null,
        startSilentRenew: jest.fn(),
        stopSilentRenew: jest.fn(),
        storeUser: jest.fn((user: unknown) => {
            state.storedUser = user;
            return Promise.resolve();
        }),
        removeUser: jest.fn(() => {
            state.storedUser = null;
            return Promise.resolve();
        }),
        signoutPopup: jest.fn(() => {
            state.storedUser = null;
            return Promise.resolve();
        }),
        loadStoredUser: jest.fn(() => Promise.resolve(state.storedUser))
    };

    class OIDCUserManager {
        public events = {
            addUserLoaded: (cb: (user: unknown) => void): (() => void) => {
                state.userLoadedHandler = cb;
                return jest.fn();
            },
            addUserUnloaded: (): (() => void) => jest.fn(),
            addSilentRenewError: (cb: (error: Error) => Promise<void>): (() => void) => {
                state.silentRenewErrorHandler = cb;
                return jest.fn();
            }
        };

        public startSilentRenew = state.startSilentRenew;

        public stopSilentRenew = state.stopSilentRenew;

        public storeUser = state.storeUser;

        public removeUser = state.removeUser;

        public loadStoredUser = state.loadStoredUser;

        public getUser = jest.fn(() => Promise.resolve(null));

        public signinSilent = jest.fn(() => Promise.resolve(null));

        public signinRedirect = jest.fn(() => Promise.resolve());

        public signoutPopup = state.signoutPopup;

        public clearStaleState = jest.fn(() => Promise.resolve());

        public constructor(public libSettings: OIDCAuthSettings) {
            state.ctorSettings.push(libSettings);
        }

        public get pendingRenew(): Promise<unknown> | null {
            return state.pendingRenew;
        }
    }

    return { OIDCUserManager, mockState: state };
});

import { DesktopNavigation } from './models/desktop-navigation.enum';
import { OIDCAuthManager } from './oidc-auth-manager';

interface MockState {
    ctorSettings: OIDCAuthSettings[];
    userLoadedHandler?: (user: unknown) => void;
    silentRenewErrorHandler?: (error: Error) => Promise<void>;
    storedUser: unknown;
    pendingRenew: Promise<unknown> | null;
    startSilentRenew: ReturnType<typeof jest.fn>;
    stopSilentRenew: ReturnType<typeof jest.fn>;
    storeUser: ReturnType<typeof jest.fn>;
    removeUser: ReturnType<typeof jest.fn>;
    signoutPopup: ReturnType<typeof jest.fn>;
    loadStoredUser: ReturnType<typeof jest.fn>;
}

const { mockState } = jest.requireMock<{ mockState: MockState }>('./oidc-user-manager');

const makeUser = (expired: boolean): User => ({
    expired,
    expires_in: (expired) ? -60 : 600,
    id_token: `id_token_${Math.random()}`,
    access_token: `access_token_${Math.random()}`,
    token_type: 'Bearer',
    scope: 'openid',
    scopes: ['openid'],
    session_state: null,
    profile: { sub: 'test-subject' }
} as unknown as User);

const baseSettings: OIDCAuthSettings = {
    authorityUrl: 'https://idp.test',
    clientId: 'test_client',
    automaticLoginOn401: false,
    automaticInjectToken: false
};

const initManager = async (settings: Partial<OIDCAuthSettings>): Promise<OIDCAuthManager> => {
    const manager = new OIDCAuthManager();
    await manager.init({ ...baseSettings, ...settings });
    return manager;
};

describe('OIDCAuthManager silent renew gating', () => {
    beforeEach(() => {
        mockState.ctorSettings.length = 0;
        mockState.userLoadedHandler = undefined;
        mockState.silentRenewErrorHandler = undefined;
        mockState.storedUser = null;
        mockState.pendingRenew = null;
        mockState.startSilentRenew.mockClear();
        mockState.stopSilentRenew.mockClear();
        mockState.storeUser.mockClear();
        mockState.removeUser.mockClear();
        mockState.signoutPopup.mockClear();
        mockState.loadStoredUser.mockClear();
    });

    describe('session not restored at startup (retrieveUserSession: false, loginRequired: false)', () => {
        it('should defer automatic silent renew at UserManager construction', async () => {
            const manager = await initManager({ retrieveUserSession: false, loginRequired: false });

            expect(mockState.ctorSettings[0]?.automaticSilentRenew).toBe(false);
            expect(mockState.startSilentRenew).not.toHaveBeenCalled();
            // The app-facing settings still report what was configured (default: true)
            expect(manager.getSettings().automaticSilentRenew).toBe(true);
        });

        it('should not start silent renew when an expired user is loaded', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });

            mockState.userLoadedHandler?.(makeUser(true));

            expect(mockState.startSilentRenew).not.toHaveBeenCalled();
        });

        it('should start silent renew once a session is established, exactly once', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });

            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).toHaveBeenCalledTimes(1);

            // Subsequent user loads (e.g. every ~10 min token rotation) must not re-start it
            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).toHaveBeenCalledTimes(1);
        });

        it('should start silent renew on the first valid session after an expired one', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });

            mockState.userLoadedHandler?.(makeUser(true));
            expect(mockState.startSilentRenew).not.toHaveBeenCalled();

            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).toHaveBeenCalledTimes(1);
        });
    });

    describe('session restored at startup (retrieveUserSession: true)', () => {
        it('should pass automaticSilentRenew through unchanged and never defer-start', async () => {
            await initManager({ retrieveUserSession: true, loginRequired: false });

            expect(mockState.ctorSettings[0]?.automaticSilentRenew).toBe(true);

            // The (real) UserManager ctor is responsible for starting it — the manager must not
            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).not.toHaveBeenCalled();
        });
    });

    describe('loginRequired: true', () => {
        it('should pass automaticSilentRenew through unchanged (session is restored/forced at startup)', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: true });

            expect(mockState.ctorSettings[0]?.automaticSilentRenew).toBe(true);

            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).not.toHaveBeenCalled();
        });
    });

    describe('automaticSilentRenew explicitly disabled by the app', () => {
        it('should never start silent renew, not even after a session is established', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false, automaticSilentRenew: false });

            expect(mockState.ctorSettings[0]?.automaticSilentRenew).toBe(false);

            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).not.toHaveBeenCalled();
        });
    });

    describe('silent renew error handler', () => {
        it('should wipe the store on invalid_grant (definitive refresh-token rejection)', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });
            mockState.storedUser = makeUser(true);

            await mockState.silentRenewErrorHandler?.({ error: 'invalid_grant' } as unknown as Error);

            expect(mockState.removeUser).toHaveBeenCalled();
        });

        it('should wipe the store on login_required (OP session gone, silent renew cannot recover)', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });
            mockState.storedUser = makeUser(true);

            await mockState.silentRenewErrorHandler?.({ error: 'login_required' } as unknown as Error);

            expect(mockState.removeUser).toHaveBeenCalled();
        });

        it('should preserve the store on a transient failure (network / timeout / 5xx)', async () => {
            await initManager({ retrieveUserSession: false, loginRequired: false });
            const storedUser = makeUser(true);
            mockState.storedUser = storedUser;

            await mockState.silentRenewErrorHandler?.(new Error('Network request failed'));

            expect(mockState.removeUser).not.toHaveBeenCalled();
            expect(mockState.storedUser).toBe(storedUser);
        });
    });

    describe('logout with preserveStoredUser', () => {
        it('should restore the persisted user after the sign-out wiped the store', async () => {
            const manager = await initManager({ retrieveUserSession: false, loginRequired: false });
            const storedUser = makeUser(true);
            mockState.storedUser = storedUser;

            await manager.logout({ desktopNavigationType: DesktopNavigation.POPUP, preserveStoredUser: true });

            // signoutPopup wiped the (mock) store mid-flow; the snapshot must have been written back
            expect(mockState.signoutPopup).toHaveBeenCalled();
            expect(mockState.storedUser).toBe(storedUser);
            expect(mockState.removeUser).not.toHaveBeenCalled();
        });

        it('should stop the silent renew loop before sign-out and re-arm it for the next session', async () => {
            const manager = await initManager({ retrieveUserSession: false, loginRequired: false });
            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).toHaveBeenCalledTimes(1);
            mockState.storedUser = makeUser(true);

            await manager.logout({ desktopNavigationType: DesktopNavigation.POPUP, preserveStoredUser: true });
            expect(mockState.stopSilentRenew).toHaveBeenCalledTimes(1);

            // The next established session must start the loop again (deferred-start re-armed)
            mockState.userLoadedHandler?.(makeUser(false));
            expect(mockState.startSilentRenew).toHaveBeenCalledTimes(2);
        });

        it('should await an in-flight renew before snapshotting the store', async () => {
            const manager = await initManager({ retrieveUserSession: false, loginRequired: false });
            const rotatedUser = makeUser(false);
            const staleUser = makeUser(true);
            mockState.storedUser = staleUser;
            // Simulate a renew in flight during logout: it lands the rotated user in the store
            mockState.pendingRenew = Promise.resolve(null).then(() => {
                mockState.storedUser = rotatedUser;
                return null;
            });

            await manager.logout({ desktopNavigationType: DesktopNavigation.POPUP, preserveStoredUser: true });

            // The snapshot must be the post-rotation user, never the consumed pre-rotation one
            expect(mockState.storedUser).toBe(rotatedUser);
        });

        it('should wipe the store on a default logout', async () => {
            const manager = await initManager({ retrieveUserSession: false, loginRequired: false });
            mockState.storedUser = makeUser(true);

            await manager.logout({ desktopNavigationType: DesktopNavigation.POPUP });

            expect(mockState.removeUser).toHaveBeenCalled();
            expect(mockState.storeUser).not.toHaveBeenCalled();
            expect(mockState.storedUser).toBeNull();
        });
    });
});
