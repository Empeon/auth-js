import type { AccessToken, UserProfile } from '@empeon/auth-js/oidc';

export type AuthGuardValidator =
    (userProfile?: UserProfile, accessToken?: AccessToken) => Promise<boolean | string> | boolean | string;
