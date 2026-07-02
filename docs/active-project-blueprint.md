# Active Project Blueprint

### 1. The North Star
- CheesyGuide is an FRC 254 interactive knowledgebase MVP: students ask an AI Teacher grounded in uploaded/team-curated sources, while mentors maintain the knowledgebase through document uploads, URL ingestion, and conversational intake.
- Immediate next epic: move from MVP testing toward production readiness by hardening auth, upload/index/delete flows, source search, deployment configuration, and AI answer reliability before adding richer textbook media.

### 2. Architectural Constraints & Invisible Context
- Persisted/domain data source of truth is Convex; Firebase/Google Cloud Storage is for uploaded original files; Gemini File Search is the retrieval/indexing layer.
- Keep the existing shared-password role gate: student password `CheddarKids`, mentor password `CheeseBoard`; no individual accounts yet.
- Mentor-only features: document upload, URL ingestion, conversational mentor intake, source delete/management, admin settings.
- Students can browse/search sources and use AI Teacher; Teacher should prefer uploaded/File Search + Convex metadata, with explicit mode control for broader Gemini/web knowledge.
- Do not duplicate Convex query data into Zustand; Zustand is only for ephemeral client UI state.
- Deleted sources should not appear in student guide, Source Management, Teacher citations, or Gemini File Search retrieval.
- Existing behavior intentionally opens original PDFs/websites directly, but generated/internal sources such as Mentor Knowledge Textbook open in local `/sources/:id`.
- Mentor Knowledge Textbook is a single living source compiled from all conversational intake, not many separate mentor-note source tiles.
- If mentor intake creates conflicting guidance, the AI should surface the conflict and allow a mentor to decide override/keep/include both; this is partially conceptual and needs fuller productization.
- Rich textbook media is desired later: mentors should eventually attach images/GIFs/links with descriptions; Gemini should place them into relevant textbook sections.
- Current markdown rendering is intentionally lightweight, not a full markdown parser.
- Production app should deploy with Firebase Hosting plus Convex production; all secrets must remain server-side/Convex env, never bundled into frontend.

### 3. The Delta (Pending Work)
- Commit/push parity:
  - Verify local `main` is pushed to GitHub after the latest commit `4179095 Render textbook inline markdown`.
  - In next session, run `git status`, `git log --oneline -5`, and compare remote/main before additional work.
- Manual acceptance pass:
  - Test student login with `CheddarKids`.
  - Test mentor login with `CheeseBoard`.
  - Test wrong password rejection.
  - Test multi-file upload with at least two supported document types.
  - Test unsupported file upload UX/error.
  - Test URL source import.
  - Test conversational mentor intake updating Mentor Knowledge Textbook.
  - Test Teacher answers/citations from uploaded docs, URL sources, and Mentor Knowledge Textbook.
  - Test source deletion removes source from Source Management, Searchable Guide, and Teacher citations.
- Firebase Storage cleanup:
  - In `convex/ai.ts` `deleteSource` and/or `convex/knowledge.ts` delete helpers, add deletion of Firebase Storage objects when deleting document sources, or explicitly document retention policy.
  - Ensure failures are reported clearly and do not leave Convex/Gemini/Firebase in inconsistent state.
- Upload and indexing hardening:
  - Add explicit upload size limits in `convex/upload.ts`.
  - Improve file validation in `convex/upload.ts` beyond MIME-only where feasible.
  - Add clearer status/state model in `convex/schema.ts` and source UI: uploaded, queued for indexing, indexing, indexed, failed.
  - Add admin/mentor-visible diagnostics for failed upload/indexing sources.
- Production security/config:
  - Restrict CORS for `convex/upload.ts` to production origin(s) instead of `*`.
  - Confirm production Convex env vars: Gemini key, Firebase service account JSON, storage bucket, Gemini/File Search settings.
  - Verify no secret values are present in frontend bundle or committed files.
  - Deploy/check Convex production and Firebase Hosting from clean envs.
- AI reliability:
  - Add a small manual/eval prompt suite for Teacher behavior: enough-context answer, insufficient-context refusal, source-only vs general vs web mode, citation formatting, no chain-of-thought/tool text leakage.
  - Confirm deleted Gemini File Search documents no longer influence Teacher output.
- Source Management search:
  - Current search covers source titles, source summaries/topics/file names/MIME for recent sources, and Convex knowledge entry bodies.
  - If keyword search inside uploaded PDFs/Office files is required, implement document text extraction into Convex knowledge entries or separate searchable text table.
- Maintenance:
  - Run `npx convex ai-files update` in a dedicated maintenance commit and review generated guidance changes before committing.
- Future rich textbook media:
  - Add Firebase Storage media upload for images/GIFs/files.
  - Add Convex media metadata table: title, description, keywords, type, storage URL, created date, optional linked source.
  - Extend mentor intake UI to attach media with mentor-provided description.
  - Replace one-large-markdown textbook model with structured sections/content blocks: heading, paragraph, list, image, GIF, link, callout, citation.
  - Add AI reorganization logic that places media into relevant sections based on description/keywords.
  - Add mentor approval/version history/rollback decision before AI reorganization becomes destructive.

### 4. Technical Debt & Hazards
- Shared-password auth is acceptable for MVP but weak for production; consider individual accounts/audit logs before broad release.
- Source delete currently removes Convex entries and Gemini File Search document when `geminiDocumentName` exists; Firebase Storage object deletion still needs confirmation/implementation.
- Convex upload CORS currently appears broad and should be locked down for production.
- Source Management search is not full-text search inside raw uploaded PDFs/Office files unless their text is also stored/indexed in Convex.
- AI Teacher can still hallucinate when broader modes are enabled; source-only mode and insufficient-context behavior need repeated eval testing.
- Gemini/File Search indexing is async/backgrounded; UI should continue to make indexing state obvious so mentors know when a source is usable.
- Current markdown rendering supports headings, lists, bold, and markdown links only; complex markdown/tables/images are not supported yet.
- Vite build reports a chunk-size warning; not blocking MVP, but code splitting may be worthwhile before production.
- Convex CLI reports AI guidance files are out of date; update separately to avoid mixing generated guidance churn with feature work.
