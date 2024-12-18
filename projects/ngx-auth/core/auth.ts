/* eslint-disable @typescript-eslint/naming-convention */

import { InjectionToken, StaticProvider } from '@angular/core';
import { initOidc, Optional } from '@empeon/auth-js/oidc';

import { AuthSettings } from './auth-settings.model';

const DEFAULT_SETTINGS: Optional<AuthSettings, 'authorityUrl' | 'clientId'> = {
    automaticLoginOn401: true,
    automaticInjectToken: {
        include: (url: string): boolean => {
            const res = new URL(url, 'http://default-base');
            return res.hostname.startsWith('api') || res.pathname.startsWith('/api') || false;
        }
    }
};

export const AUTH_MANAGER = new InjectionToken<string>('AUTH_MANAGER');

export const initAuth = async (settings: AuthSettings): Promise<StaticProvider> => ({
    provide: AUTH_MANAGER,
    useValue: await initOidc({ ...DEFAULT_SETTINGS, ...settings }),
    multi: false
});
