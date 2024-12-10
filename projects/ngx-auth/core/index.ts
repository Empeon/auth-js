/**
 * @license
 * @badisi/ngx-auth (core build) <https://github.com/Badisi/auth-js/tree/main/projects/ngx-auth>
 * Released under GNU General Public License v3.0 only <https://github.com/Badisi/auth-js/blob/main/LICENSE>
 * SPDX-License-Identifier: GPL-3.0-only
 * Copyright (C) 2018 Badisi
 */

export { AuthUtils, DesktopNavigation, Log, User, UserSession } from '@empeon/auth-js/oidc';
export type { AccessToken, IdToken, LoginArgs, LogoutArgs, MobileWindowParams, RenewArgs, SigninMobileArgs, SignoutMobileArgs, UserProfile } from '@empeon/auth-js/oidc';

export type { AuthSettings, InjectToken, InjectTokenPattern } from './auth-settings.model';
export type { AuthGuardData, AuthGuardValidator } from './auth.guard';

export { initAuth } from './auth';
export { AuthGuard } from './auth.guard';
export { AuthInterceptor } from './auth.interceptor';
export { AuthModule } from './auth.module';
export { provideAuth } from './auth.provider';
export { AuthService } from './auth.service';

