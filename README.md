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

## Integration Environment

Set these in Convex environment variables for live AI and Drive integrations.
On Windows PowerShell, use `npx.cmd` so PowerShell does not block the shim script.

```powershell
npx.cmd convex env set GEMINI_API_KEY "your-key"
```

For Google Drive, use the downloaded service account JSON file. The base64 path is
the most reliable PowerShell setup:

```powershell
$json = Get-Content .\service-account.json -Raw
$base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
$base64 | npx.cmd convex env set GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
```

If a malformed raw JSON value was set earlier, remove it so the base64 value is
used first:

```powershell
npx.cmd convex env remove GOOGLE_SERVICE_ACCOUNT_JSON
```

Set the Drive folder ID in `/admin`, or write it directly through the admin UI.
Without these values, uploads and AI features still create Convex records but
show integration-missing status.

## Stack

- Bun
- React Router 7 in SPA mode
- Vite, React, and strict TypeScript
- Tailwind CSS v4
- shadcn/ui with Base UI, CSS variables, Lucide icons, and Sonner
- Convex for sessions, settings, metadata, live queries, mutations, and persistence
- Gemini Flash and Gemini File Search
- Google Drive file storage
- Zustand for ephemeral UI state only
- next-themes class-based light/dark/system mode
