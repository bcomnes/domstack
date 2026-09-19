# Local author registry

Import or refresh a public GitHub profile:

```sh
npm run import-author -- bcomnes
node --test tools/authors/import.test.js
```

Importing makes bounded HTTPS requests to `api.github.com` for the profile and social accounts, `avatars.githubusercontent.com` for the avatar, and `github.com` for public SSH/GPG keys. GitHub rate limits apply. An optional `GITHUB_TOKEN` environment variable is sent only to `api.github.com` and is never written to metadata.

Redirects are rejected, no token is needed for public profiles, and network failures, timeouts, invalid responses, and HTTP errors fail the import before replacing existing data. Organization-only 404s for social accounts or keys are treated as empty; other errors remain fatal. Requests have a 20-second deadline, 1 MiB text limits, and a 10 MiB avatar limit.

## Files and schema

Each `authors/<lowercase-github-username>/` directory contains `author-meta.json` and `avatar.jpg`, `avatar.png`, `avatar.gif`, or `avatar.webp`.

Metadata schema version 1 contains:

- `schemaVersion`: `1`
- `username`: canonical lowercase GitHub login
- `name`: GitHub display name, falling back to login
- `profile`: `https://github.com/<username>`
- `website`: normalized HTTP(S) profile website, or `null`
- `links`: public social accounts as `{ provider, url }` objects
- `avatar`: a relative avatar filename
- `keys`: public SSH keys, possibly empty
- `gpg`: public armored GPG data, possibly empty

Only public data is stored. These files are intended to be checked in; do not add private information or credentials.

## Runtime API

`site/lib/authors.ts` exports `AuthorRegistry`, `authorRegistry`, `resolveBlogAuthors`, `authorRegistryDirectory`, and metadata validation helpers.

`AuthorRegistry` lazily reads one username at a time, shares in-flight and successful reads, evicts failed reads for retry, returns frozen author objects, and supports `clear(username?)`. `resolveBlogAuthors` requires a nonempty array of unique registered GitHub usernames and preserves input order. It has no default and rejects legacy aliases such as `bret`, `joe`, and `oro`.

Resolved author URLs prefer the imported website and fall back to the GitHub profile. Avatar URLs are local `/authors/<username>/<filename>` paths so builds do not contact GitHub.

The registry reads metadata through `fs`, so DOMStack does not automatically invalidate pages when registry files change. Restart the watch process after importing authors or manually editing metadata, or run a fresh build.

Refreshes replace an entire author directory through a staged directory and rollback backup on the same filesystem. A per-author lock prevents concurrent imports. Inspect a stale `.username.lock/previous` backup before removing it manually.
