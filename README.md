# CheesyGuide

Interactive FRC 254 knowledgebase with shared-password access, mentor uploads,
URL ingestion, searchable sources, and a Gemini-powered AI Teacher.

## Codex Run Command

```sh
bun run codex
```

The command installs dependencies, starts Convex against the linked dev deployment,
and runs Vite through Convex:

```sh
bun install && bunx convex dev --start "bun run dev"
```

## Scripts

```sh
bun run dev
bun run dev:full
bun run build
bun run lint
bun run typecheck
```

## Firebase and AI Setup

Firebase Hosting and Storage are configured for project `cheesyguide-e2aee`.
Build and deploy the SPA plus Storage rules with:

```sh
bun run deploy
```

Files are stored in Firebase Storage bucket
`cheesyguide-e2aee.firebasestorage.app`. Convex remains the source of truth for
shared-password sessions, settings, knowledge metadata, source records, and
conversation state.

Set these in Convex environment variables for live AI and Storage integrations.
On Windows PowerShell, use `npx.cmd` so PowerShell does not block shim scripts:

```powershell
npx.cmd convex env set GEMINI_API_KEY "your-key"
npx.cmd convex env set FIREBASE_STORAGE_BUCKET "cheesyguide-e2aee.firebasestorage.app"
```

For Firebase Storage uploads from Convex, use a Google Cloud service account
JSON file with permission to create objects in the bucket. The base64 path is
the most reliable PowerShell setup:

```powershell
$json = Get-Content .\service-account.json -Raw
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
$base64 | npx.cmd convex env set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
```

If a malformed raw JSON value was set earlier, remove it:

```powershell
npx.cmd convex env remove GOOGLE_SERVICE_ACCOUNT_JSON
```

The Firebase Storage bucket can also be edited in `/admin`. Without these
values, uploads and AI features still create Convex records but show
integration-missing status.

## Stack

- Bun
- React Router 7 in SPA mode
- Vite, React, and strict TypeScript
- Tailwind CSS v4
- shadcn/ui with Base UI, CSS variables, Lucide icons, and Sonner
- Convex for sessions, settings, metadata, live queries, mutations, and persistence
- Gemini Flash and Gemini File Search
- Firebase Hosting and Firebase Storage / Google Cloud Storage
- Zustand for ephemeral UI state only
- next-themes class-based light/dark/system mode
