# Development

This document describes how you can test, build and publish the library.

## Prerequisite

Before you can build and test this library you must install and configure the following products on your development machine:

* [Node.js][nodejs]
* [Git][git]

You will then need to install the library required dependencies:

```sh
cd <library-path>
npm install
```

## Testing locally

The libraries live in `libs/auth-js` and `libs/ngx-auth`. Lint and unit tests (jest) run with:

```sh
npm run lint
npm run test:ci           # both libs, or per lib:
npx nx test auth-js
npx nx test ngx-auth
```

To try changes inside a consuming app before publishing, vendor the sources into the app behind
tsconfig `paths` aliases (as done in WorkforceWeb's `Client/libs/authjs` during development) —
remember it is a one-way copy from this repo; never hand-edit the vendored copy.

## Building the libraries

The libraries are built into the `./dist` directory (this is also what gets published):

```sh
npm run build
```

## Publishing to NPM repository

> This is an Empeon fork of the upstream project. Unlike upstream, this repo has **no CI/CD pipeline** —
> releases are triggered manually, from your machine, using `nx release` under the hood. Only
> `@empeon/auth-js` and `@empeon/ngx-auth` (the two `workspaces` in `./package.json`) are published,
> to GitHub Packages (`npm.pkg.github.com`), not the public npm registry.

### Prerequisite

Authenticate to GitHub Packages once per machine, using a GitHub PAT with `write:packages` scope as the password:

```sh
npm login --scope=@empeon --registry=https://npm.pkg.github.com
```

### Versioning is automatic — do not hand-edit `package.json`

The version bump (`fix:` → patch, `feat:` → minor, `BREAKING CHANGE:` → major) is computed from
[conventional commits](CONTRIBUTING.md#commit) made since the last release tag. The release script writes
the new version into each project's `package.json` itself and commits it — manually bumping the version
first is unnecessary and can drift out of sync with what the tool computes.

### Releasing

1. Make sure you're on a clean, up-to-date `main` and logged in to GitHub Packages (see above).

2. **Build first** — the release script publishes `./dist` but does NOT build it; a missing or
   stale `dist` fails the release midway (after commits/tags were already pushed) or, worse,
   publishes outdated code under the new version:

   ```sh
   npm run build
   ```

3. Preview what would happen (no changes made):

   ```sh
   npm run release:dry-run
   ```

   Confirm the version bump (e.g. `2.0.0 → 2.0.1`) and changelog look right before proceeding.

4. Run it for real:

   ```sh
   npm run release
   ```

   This bumps versions, updates changelogs, commits, tags (`@empeon/<project>@<version>`), pushes,
   **publishes both packages to GitHub Packages**, and creates GitHub releases — e.g.
   [v2.0.0](https://github.com/Empeon/auth-js/releases/tag/v2.0.0).

See [`scripts/release.mjs`](scripts/release.mjs) for the full step-by-step the script performs.



[git]: https://git-scm.com/
[nodejs]: https://nodejs.org/
