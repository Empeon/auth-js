/* eslint-disable @typescript-eslint/no-empty-object-type */

/**
 * @license GPL-3.0-only
 * Package `@empeon/ngx-auth` <https://github.com/Badisi/auth-js/tree/main/libs/ngx-auth>
 * Released under GNU General Public License v3.0 only <https://github.com/Badisi/auth-js/blob/main/LICENSE>
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2018 Badisi
 */

// Initialize the logger
import { AuthLogger } from '@empeon/auth-js';

AuthLogger.init('@empeon/ngx-auth');

// @empeon/auth-js re-exports renamed
import type { OIDCAuthManager, OIDCAuthSettings } from '@empeon/auth-js/oidc';
export interface AuthManager extends OIDCAuthManager {}
export interface AuthSettings extends OIDCAuthSettings {}

// @empeon/auth-js re-exports
export type {
    AccessToken,
    AuthGuardOptions,
    AuthGuardValidator,
    IdToken,
    InjectToken,
    InjectTokenPattern,
    LoginArgs,
    LogoutArgs,
    MobileWindowParams,
    RenewArgs,
    SigninMobileArgs,
    SignoutMobileArgs,
    UserProfile,
    UserSession
} from '@empeon/auth-js/oidc';
export {
    decodeJwt,
    DesktopNavigation,
    getBaseUrl,
    isCapacitor,
    isCordova,
    isNativeMobile,
    LogLevel
} from '@empeon/auth-js/oidc';

// Library exports
export { authGuard } from './auth.guard';
export { initAuth, provideAuth } from './auth.provider';
export { AuthService } from './auth.service';
