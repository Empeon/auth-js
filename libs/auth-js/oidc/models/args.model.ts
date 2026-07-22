import type {
    ExtraSigninRequestArgs, ExtraSignoutRequestArgs, IFrameWindowParams, PopupWindowParams,
    RedirectParams
} from 'oidc-client-ts';

import type { DesktopNavigation } from './desktop-navigation.enum';
import type { MobileWindowParams } from './mobile-window-params.model';

export type LoginArgs = MobileWindowParams & PopupWindowParams & RedirectParams & Omit<ExtraSigninRequestArgs, 'redirect_uri'> & {
    redirectUrl?: string;
    desktopNavigationType?: DesktopNavigation;
};

export type LogoutArgs = MobileWindowParams & PopupWindowParams & RedirectParams & Omit<ExtraSignoutRequestArgs, 'post_logout_redirect_uri'> & {
    redirectUrl?: string;
    desktopNavigationType?: DesktopNavigation;
    /**
     * Keep the persisted OIDC session (incl. the refresh token) in the user store after the
     * sign-out completes, instead of wiping it. The IDP session is still properly ended and the
     * in-memory session is cleared — but a gated re-entry flow (e.g. a biometric unlock reading
     * the store via `getStoredUser()` and calling `renew()`) keeps working across the sign-out,
     * matching the legacy behavior where a biometric refresh-token copy survived logout.
     * Supported by the mobile and popup sign-out flows; ignored by the full-page redirect flow
     * (the page navigates away before the store could be restored). Defaults to `false`.
     *
     * Incompatible with `internal.revokeTokensOnSignout: true` — that setting revokes the refresh
     * token server-side during the sign-out, so the preserved session would report as present via
     * `getStoredUser()` yet its next renew is a guaranteed `invalid_grant`.
     */
    preserveStoredUser?: boolean;
};

export type RenewArgs = IFrameWindowParams & ExtraSigninRequestArgs;

export type SigninMobileArgs = MobileWindowParams & ExtraSigninRequestArgs;

export type SignoutMobileArgs = MobileWindowParams & ExtraSignoutRequestArgs;
