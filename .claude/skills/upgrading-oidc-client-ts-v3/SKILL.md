---
name: upgrading-oidc-client-ts-v3
description: Use when upgrading the @empeon/auth-js fork's oidc-client-ts dependency from v2.x to v3.x (e.g. to drop crypto-js for native crypto.subtle, get nonce validation), or when scoping that upgrade's cost, risks, and breaking changes.
---

# Upgrading oidc-client-ts 2.4.0 → 3.5.0 (@empeon/auth-js)

## Overview
`@empeon/auth-js` vendors `oidc-client-ts`. Moving v2.4.0 → ^3.5.0 is a *small* major
bump for this fork: investigation found no removed/renamed settings in use and the
internal APIs the mobile UserManager subclass relies on are intact in v3.5.0. The one
behavioral break is crypto-js → native `crypto.subtle` (secure-context only).

Upstream Badisi/auth-js is still on v2 (issue #40 open since 2024) — this is a
fork-only change and a standing customization to re-apply across upstream syncs
(see the `syncing-fork-with-upstream` memory).

## Why it's low-risk here (verified)
- **No settings migration.** v3 removed `clockSkewInSeconds`, `userInfoJwtIssuer`,
  `refreshTokenCredentials` and renamed `mergeClaims → mergeClaimsStrategy`; changed
  `response_mode` default query→undefined. `libs/auth-js/oidc/default-settings.ts` uses
  none of these; `response_mode` appears only in commented-out dead code in
  `oidc-user-manager.ts`.
- **Internal APIs intact in v3.5.0** (verified against source): protected
  `_signin(args, handle, verifySub?)`, `_signout(args, handle)`, `_logger`, `settings`,
  and `events.addUserLoaded/addUserUnloaded/addSilentRenewError`. Public methods used
  (`signinSilent`, `storeUser`, `removeUser`, `getUser`, `clearStaleState`,
  `signin/signoutRedirectCallback`, popup/redirect) are unchanged.
- **jwt-decode is independent.** The fork's own `jwt-decode@^3` (`core/auth-utils.ts`
  `decodeJwt`) is unrelated to oidc-client-ts's internal bump to jwt-decode v4. Leave
  the fork at v3 — bumping to v4 is a *separate* breaking change.

## The real break: crypto.subtle (secure context)
v3 drops crypto-js for native `crypto.subtle`, which requires a secure context.
Empeon runs **Web (HTTPS) + Capacitor** — both secure contexts, so functionally OK,
but two things must be validated:
1. **Capacitor on-device**: signinMobile/signoutMobile, silent renew, and the
   biometric `getUser/storeUser/removeUser` flow.
2. **jsdom tests**: if a test exercises an oidc-client-ts crypto path, add a Web Crypto
   polyfill to the jest setup: `globalThis.crypto = require('node:crypto').webcrypto`
   (Node 20+/24 provides it). Existing tests are URL-utils + schematics, so they may
   pass untouched.

## Steps
1. Set `"oidc-client-ts": "^3.5.0"` in `libs/auth-js/package.json`; `npm install`.
2. `npx nx run auth-js:build` + `npx nx run ngx-auth:build-lib`; fix any compile errors,
   focused on: `oidc-user-manager.ts` (`_signin`/`_signout` arg types
   `CreateSigninRequestArgs`/`CreateSignoutRequestArgs`, `_logger.create()`),
   `oidc-auth-interceptor.ts` (`metadataService._metadata`, already `@ts-expect-error`),
   `mobile/mobile-storage.ts` + `mobile/mobile-window.ts` (`AsyncStorage`, `IWindow`,
   `NavigateParams`, `NavigateResponse`), `models/args.model.ts` &
   `models/oidc-auth-settings.model.ts` (composed types), `core/auth-logger.ts`
   (`Log`/`ILogger`).
3. `npx nx run auth-js:test` + `npx nx run ngx-auth:test` (add crypto polyfill only if a
   test needs it). `npx eslint .` → 0 errors.
4. Confirm the browser self-contained bundle still builds (oidc-client-ts external for
   esm/cjs, bundled for iife via `build.mjs`; LICENSE copy still applies).
5. Runtime-validate: web HTTPS login/renew/logout + interceptor; Capacitor device build
   exercising mobile signin/signout + biometric store/get/remove.
6. Version bump: public `@empeon/*` API unchanged and both runtimes are secure contexts
   → minor (e.g. 2.1.0); bump `ngx-auth`'s `@empeon/auth-js` dep to match. Use major
   only if you want to signal dropped non-secure-context support.
7. Ship via the established flow: commit, push, rebuild, `npm publish ./dist/auth-js` +
   `./dist/ngx-auth` to GitHub Packages, tag + optional Release.

## Verification
- Both builds succeed (no type errors, no crypto-js in deps).
- auth-js + ngx-auth tests green; lint 0 errors.
- Manual web + Capacitor runtime checks pass.

## After upgrading
- Update the `syncing-fork-with-upstream` memory: v3 is now a 4th fork customization to
  re-apply/reconcile on future upstream syncs; watch issue #40.
