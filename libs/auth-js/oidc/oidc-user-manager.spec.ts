/* eslint-disable @typescript-eslint/naming-convention, camelcase */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { InMemoryWebStorage, type User, UserManager, WebStorageStateStore } from 'oidc-client-ts';

import type { OIDCAuthSettings } from './models/oidc-auth-settings.model';
import { OIDCUserManager } from './oidc-user-manager';

const AUTHORITY = 'https://idp.test';
const CLIENT_ID = 'test_client';
// Same key `_loadUser()` reads (WebStorageStateStore applies its own `oidc.` prefix internally)
const USER_STORE_KEY = `user:${AUTHORITY}:${CLIENT_ID}`;

const createManager = (): { manager: OIDCUserManager; userStore: WebStorageStateStore } => {
    const userStore = new WebStorageStateStore({ store: new InMemoryWebStorage() });
    const manager = new OIDCUserManager({
        authorityUrl: AUTHORITY,
        clientId: CLIENT_ID,
        internal: {
            redirect_uri: 'http://localhost/callback',
            userStore
        }
    } as OIDCAuthSettings);
    return { manager, userStore };
};

describe('OIDCUserManager', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('signinSilent single-flight', () => {
        it('should coalesce concurrent calls onto one in-flight renew', async () => {
            const { manager } = createManager();
            const renewedUser = {} as User;
            let resolveRenew!: (user: User | null) => void;
            const parentSigninSilent = jest
                .spyOn(UserManager.prototype, 'signinSilent')
                .mockImplementation(() => new Promise<User | null>(resolve => {
                    resolveRenew = resolve;
                }));

            const first = manager.signinSilent();
            const second = manager.signinSilent();

            // Both callers share ONE token request (rotation forbids parallel refreshes)
            expect(parentSigninSilent).toHaveBeenCalledTimes(1);
            const pending = manager.pendingRenew;
            expect(pending).not.toBeNull();

            resolveRenew(renewedUser);
            await expect(first).resolves.toBe(renewedUser);
            await expect(second).resolves.toBe(renewedUser);
            await expect(pending).resolves.toBe(renewedUser);
            expect(manager.pendingRenew).toBeNull();

            // Once settled, the next call starts a fresh renew
            const third = manager.signinSilent();
            expect(parentSigninSilent).toHaveBeenCalledTimes(2);
            resolveRenew(null);
            await expect(third).resolves.toBeNull();
        });

        it('should clear the in-flight renew when it rejects', async () => {
            const { manager } = createManager();
            jest.spyOn(UserManager.prototype, 'signinSilent')
                .mockImplementation(() => Promise.reject(new Error('renew failed')));

            await expect(manager.signinSilent()).rejects.toThrow('renew failed');
            expect(manager.pendingRenew).toBeNull();
        });
    });

    describe('loadStoredUser', () => {
        it('should resolve the persisted user', async () => {
            const { manager, userStore } = createManager();
            await userStore.set(USER_STORE_KEY, JSON.stringify({
                access_token: 'at',
                token_type: 'Bearer',
                refresh_token: 'rt',
                profile: { sub: 'test-subject' }
            }));

            const user = await manager.loadStoredUser();

            expect(user?.access_token).toBe('at');
            expect(user?.refresh_token).toBe('rt');
        });

        it('should resolve null when nothing is persisted', async () => {
            const { manager } = createManager();

            await expect(manager.loadStoredUser()).resolves.toBeNull();
        });

        it('should resolve null (not reject) on a corrupt / unreadable record', async () => {
            const { manager, userStore } = createManager();
            await userStore.set(USER_STORE_KEY, 'not-json{{{');

            await expect(manager.loadStoredUser()).resolves.toBeNull();
        });
    });
});
