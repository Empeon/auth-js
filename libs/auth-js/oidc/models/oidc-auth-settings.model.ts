import type { UserManagerSettings } from 'oidc-client-ts';

import type { AuthSettings as CoreAuthSettings, LogLevel } from '../../core';
import type { DesktopNavigation } from './desktop-navigation.enum';
import type { InjectToken } from './inject-token.model';
import type { MobileWindowParams } from './mobile-window-params.model';
import type { SecureStorage } from './secure-storage.model';

// TODO: check if `monitorSession` and `revokeAccessTokenOnSignout` might be useful too ?
type UsefulSettings = 'scope' | 'loadUserInfo' | 'automaticSilentRenew';

export interface OIDCAuthSettings extends CoreAuthSettings, Partial<Pick<UserManagerSettings, UsefulSettings>> {
    authorityUrl: string;
    clientId: string;
    mobileScheme?: string;
    /**
     * Optional override for the store that persists the OIDC session (incl. the refresh token).
     * Supply a platform implementation (e.g. a chunking or AES Capacitor secure-storage wrapper on
     * native) to control where/how the session is persisted. When omitted, the package uses its
     * built-in store: `MobileStorage` on native (Capacitor secure-storage / preferences / localStorage)
     * and an in-memory store on web/desktop (no persistence across restarts).
     */
    secureStorage?: SecureStorage;
    retrieveUserSession?: boolean;
    automaticLoginOn401?: boolean;
    automaticInjectToken?: InjectToken;
    desktopNavigationType?: DesktopNavigation;
    logLevel?: LogLevel;
    internal?: Partial<Omit<UserManagerSettings, UsefulSettings | 'authority' | 'client_id'>> & MobileWindowParams;
}
