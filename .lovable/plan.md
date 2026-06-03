## 1. Remove Google login

- Strip the `lovable.auth.signInWithOAuth("google", …)` button from `src/routes/login.tsx`.
- Keep email + password as the only public auth method.
- Disable `google` in Supabase social auth config.

## 2. License-key system

New table `public.licenses`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `key` | text unique | format `TGPT-XXXX-XXXX-XXXX` |
| `tier` | text | `free` / `pro` / `team` |
| `credits_per_day` | int | 5 / 50 / 200 |
| `claimed_by` | uuid null | auth.users.id once claimed |
| `claimed_at` | timestamptz null | |
| `created_by` | uuid | admin who issued it |
| `note` | text null | admin label |
| `created_at` | timestamptz | |

RLS:
- admins: full access
- users: SELECT their own claimed license only

Functions (SECURITY DEFINER):
- `admin_create_license(_tier, _credits, _note, _count)` → returns generated keys (admin-only).
- `claim_license(_key)` → marks license claimed by `auth.uid()`, bumps `credits.balance` to `credits_per_day`, sets a `license_id` on profile.
- `admin_list_licenses()` → admin-only listing.

`profiles` gets `license_id uuid null` so we know each user's active license. `credits.daily_cap` column added so `reset_credits_if_needed` resets to the user's licensed cap (default 5 if no license).

## 3. Signup/login flow with license

- New `/login` UI has two tabs: **Sign in** (email + password) and **Sign up** (email + password + license key).
- On signup: `supabase.auth.signUp` → on success call `claim_license(key)` server fn. If claim fails, the user is deleted (cleanup) and shown an error.
- Existing users without a license get redirected to a new `/redeem` page where they paste a key once.
- Guest flow (5 free messages) stays as-is.

## 4. Admin panel — license management

In `src/routes/_authenticated/admin.tsx` add a "Licenses" tab:
- Form: tier dropdown, credits/day, note, quantity → "Generate". Shows generated keys with a copy button.
- Table of all licenses (key, tier, credits/day, claimed by email, created_at). Filter: unclaimed only.
- Bulk copy / revoke (set `claimed_by = null` + delete).

## 5. Multi-file builder (Lovable-style)

Replace single-row `builder_threads.html/css/js` with a per-file table.

New table `public.builder_files`:

| column | type |
|---|---|
| `id` | uuid pk |
| `thread_id` | uuid (FK builder_threads) |
| `user_id` | uuid |
| `path` | text (`src/App.tsx`, `package.json`, `index.html`, `src/styles.css`, etc.) |
| `content` | text |
| `language` | text (`tsx`, `ts`, `css`, `html`, `json`, `js`, `md`) |
| `updated_at` | timestamptz |

Unique `(thread_id, path)`. RLS: owner + admin.

`builder_threads` keeps `title`, `entry_path` (default `index.html`), drops html/css/js (left in place but ignored by new code path, optional drop later).

### Builder AI contract

`/api/builder` is rewritten so the model returns JSON like:

```json
{
  "summary": "Built a React landing page",
  "entry": "index.html",
  "files": [
    { "path": "package.json", "language": "json", "content": "…" },
    { "path": "index.html", "language": "html", "content": "…" },
    { "path": "src/main.tsx", "language": "tsx", "content": "…" },
    { "path": "src/App.tsx", "language": "tsx", "content": "…" },
    { "path": "src/styles.css", "language": "css", "content": "…" },
    { "path": "tailwind.config.js", "language": "js", "content": "…" }
  ]
}
```

System prompt is rewritten to demand a full project (React + Vite + Tailwind by default, or a static multi-file site if simpler). Allowed file types: `tsx, ts, js, jsx, css, html, json, md, svg, txt, env`.

Server saves each file into `builder_files` (upsert by `(thread_id, path)`), deletes files no longer in the response.

### Builder UI rewrite

`src/routes/_authenticated/builder.$threadId.tsx`:
- Three-pane layout: left chat, middle file tree + Monaco editor (read-only first pass, edit later), right live preview.
- File tree from `builder_files`, grouped by folder.
- Preview: for static projects, build a sandbox `<iframe srcdoc>` that inlines linked files. For React projects, use **Sandpack** (`@codesandbox/sandpack-react`) — pass in all files, let Sandpack bundle.
- "Download ZIP" button (jszip) → zips all files.
- "Delete project" stays.

Dependencies to add: `@codesandbox/sandpack-react`, `jszip`, `@monaco-editor/react`.

## 6. Files touched

- DB migration: `licenses`, `builder_files`, `profiles.license_id`, `credits.daily_cap`, new RPCs, updated `handle_new_user` / `reset_credits_if_needed`.
- `src/routes/login.tsx` — remove Google, add license-tabbed UI.
- `src/routes/redeem.tsx` — new.
- `src/routes/_authenticated.tsx` — redirect users without a license to `/redeem`.
- `src/routes/_authenticated/admin.tsx` — license tab.
- `src/routes/api/builder.ts` — rewrite for multi-file output + ownership check.
- `src/routes/_authenticated/builder.$threadId.tsx` — full UI rewrite (Sandpack + Monaco + file tree).
- `src/routes/_authenticated/builder.tsx` — preview thumbnails read from `builder_files`.
- `package.json` — sandpack, monaco, jszip.

## 7. Out of scope (call out)

- **No Google OAuth** anywhere after this change. Existing Google-only accounts can still sign in (Supabase keeps them), but new logins via Google are gone from the UI.
- File **editing** in Monaco will be view-only in this pass (the AI is the editor). Adding manual edits + save-back to DB would be a follow-up.
- Sandpack live-bundles in the browser; no server build step.

## 8. Implementation order

1. DB migration (licenses + builder_files + RPCs).
2. Login UI: remove Google, add tabs + license field, `/redeem` route, `_authenticated` gate.
3. Admin license tab.
4. Install Sandpack/Monaco/jszip.
5. Rewrite `/api/builder` for multi-file output.
6. Rewrite builder thread UI with file tree + Sandpack + ZIP download.

Confirm and I'll execute in this order.