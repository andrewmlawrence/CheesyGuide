import { useAction, useQuery } from "convex/react"
import { DatabaseIcon, Loader2Icon, RefreshCwIcon, SaveIcon, Trash2Icon } from "lucide-react"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { ProtectedRoute } from "@/components/protected-route"
import { useSession } from "@/components/session-provider"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { api } from "@/lib/convex"

type FileSearchDiagnostics = {
  configured: boolean
  store?: {
    name?: string
    displayName?: string
    activeDocumentsCount?: string
    pendingDocumentsCount?: string
    failedDocumentsCount?: string
  }
  documents: Array<{
    name?: string
    displayName?: string
    createTime?: string
    updateTime?: string
  }>
  storage?:
    | {
        configured?: true
        bucket: string
        totalObjects: number
        totalBytes: number
        trackedObjects: number
        untrackedObjects: StorageObjectDiagnostic[]
        duplicates: Array<{
          originalFileName: string
          size: number
          objects: StorageObjectDiagnostic[]
          untrackedPaths: string[]
        }>
        recentObjects: StorageObjectDiagnostic[]
      }
    | {
        configured: false
        error: string
      }
}

type StorageObjectDiagnostic = {
  path: string
  size: number
  updated?: string
  timeCreated?: string
  contentType?: string
  originalFileName?: string
  tracked: boolean
  sourceId?: string
  sourceTitle?: string
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

function AdminRoute() {
  return (
    <ProtectedRoute mentorOnly>
      <AdminSettings />
    </ProtectedRoute>
  )
}

function AdminSettings() {
  const { sessionToken } = useSession()
  const settings = useQuery(
    api.auth.getSettings,
    sessionToken ? { sessionToken } : "skip",
  )
  const updateSettings = useAction(api.auth.updateSettings)
  const getFileSearchDiagnostics = useAction(api.ai.getFileSearchDiagnostics)
  const deleteUntrackedStorageObjects = useAction(api.ai.deleteUntrackedStorageObjects)
  const [studentPassword, setStudentPassword] = useState("")
  const [mentorPassword, setMentorPassword] = useState("")
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash")
  const [storageBucket, setStorageBucket] = useState("cheesyguide-e2aee.firebasestorage.app")
  const [fileSearchStoreName, setFileSearchStoreName] = useState("")
  const [allowUrlSources, setAllowUrlSources] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false)
  const [isDeletingStorage, setIsDeletingStorage] = useState(false)
  const [diagnostics, setDiagnostics] = useState<FileSearchDiagnostics | null>(null)

  useEffect(() => {
    if (!settings) return
    setGeminiModel(settings.geminiModel)
    setStorageBucket(settings.storageBucket)
    setFileSearchStoreName(settings.fileSearchStoreName)
    setAllowUrlSources(settings.allowUrlSources)
  }, [settings])

  const loadDiagnostics = useCallback(async () => {
    if (!sessionToken) return
    setIsLoadingDiagnostics(true)
    try {
      setDiagnostics(await getFileSearchDiagnostics({ sessionToken }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load diagnostics")
    } finally {
      setIsLoadingDiagnostics(false)
    }
  }, [getFileSearchDiagnostics, sessionToken])

  useEffect(() => {
    if (!sessionToken) return
    void loadDiagnostics()
  }, [loadDiagnostics, sessionToken])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!sessionToken) return
    setIsSaving(true)

    try {
      await updateSettings({
        sessionToken,
        studentPassword: studentPassword || undefined,
        mentorPassword: mentorPassword || undefined,
        geminiModel,
        storageBucket,
        fileSearchStoreName,
        allowUrlSources,
      })
      toast.success("Settings saved")
      setStudentPassword("")
      setMentorPassword("")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Settings save failed")
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDeleteUntracked(paths: string[]) {
    if (!sessionToken || paths.length === 0) return
    setIsDeletingStorage(true)
    try {
      const result = await deleteUntrackedStorageObjects({ sessionToken, paths })
      toast.success(
        result.deleted === 1
          ? "Deleted 1 untracked Storage object"
          : `Deleted ${result.deleted} untracked Storage objects`,
      )
      await loadDiagnostics()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Storage cleanup failed")
    } finally {
      setIsDeletingStorage(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Admin</p>
        <h1 className="text-3xl font-medium">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Change shared passwords and integration settings. Leave password
          fields blank to keep the current values.
        </p>
      </div>
      <form className="mt-8 space-y-5 rounded-lg border p-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="student-password">Student password</Label>
            <Input
              id="student-password"
              type="password"
              placeholder="Leave unchanged"
              value={studentPassword}
              onChange={(event) => setStudentPassword(event.currentTarget.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mentor-password">Mentor password</Label>
            <Input
              id="mentor-password"
              type="password"
              placeholder="Leave unchanged"
              value={mentorPassword}
              onChange={(event) => setMentorPassword(event.currentTarget.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gemini-model">Gemini model</Label>
          <Input
            id="gemini-model"
            value={geminiModel}
            onChange={(event) => setGeminiModel(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="storage-bucket">Firebase Storage bucket</Label>
          <Input
            id="storage-bucket"
            value={storageBucket}
            onChange={(event) => setStorageBucket(event.currentTarget.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="file-search-store">Gemini File Search store</Label>
          <Input
            id="file-search-store"
            value={fileSearchStoreName}
            onChange={(event) => setFileSearchStoreName(event.currentTarget.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={allowUrlSources}
            onCheckedChange={(checked) => setAllowUrlSources(Boolean(checked))}
          />
          Allow mentor URL sources
        </label>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
          Save settings
        </Button>
      </form>
      <section className="mt-6 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-primary" />
            <h2 className="text-sm font-medium">File Search diagnostics</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isLoadingDiagnostics}
            onClick={() => void loadDiagnostics()}
          >
            {isLoadingDiagnostics ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Refresh
          </Button>
        </div>
        {!diagnostics ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Diagnostics have not loaded yet.
          </p>
        ) : !diagnostics.configured ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Gemini File Search is not configured for this deployment.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="font-medium">{diagnostics.store?.activeDocumentsCount ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Pending</p>
                <p className="font-medium">{diagnostics.store?.pendingDocumentsCount ?? "0"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Failed</p>
                <p className="font-medium">{diagnostics.store?.failedDocumentsCount ?? "0"}</p>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {diagnostics.store?.displayName ?? diagnostics.store?.name}
              </p>
              {diagnostics.documents.length > 0 ? (
                diagnostics.documents.map((document) => (
                  <article key={document.name} className="rounded-md border p-3">
                    <p className="text-sm font-medium">
                      {document.displayName ?? document.name}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Updated {document.updateTime ?? "unknown"}
                    </p>
                  </article>
                ))
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  No File Search documents were returned.
                </p>
              )}
            </div>
          </div>
        )}
      </section>
      <section className="mt-6 rounded-lg border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-primary" />
            <h2 className="text-sm font-medium">Storage usage</h2>
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={isLoadingDiagnostics}
            onClick={() => void loadDiagnostics()}
          >
            {isLoadingDiagnostics ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            Refresh
          </Button>
        </div>
        {!diagnostics?.storage ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Storage diagnostics have not loaded yet.
          </p>
        ) : diagnostics.storage.configured === false ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {diagnostics.storage.error}
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Bucket</p>
                <p className="truncate font-medium">{diagnostics.storage.bucket}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Stored</p>
                <p className="font-medium">{formatBytes(diagnostics.storage.totalBytes)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Objects</p>
                <p className="font-medium">{diagnostics.storage.totalObjects}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Untracked</p>
                <p className="font-medium">{diagnostics.storage.untrackedObjects.length}</p>
              </div>
            </div>

            {diagnostics.storage.duplicates.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Duplicate file groups
                </p>
                {diagnostics.storage.duplicates.map((group) => (
                  <article
                    key={`${group.originalFileName}-${group.size}`}
                    className="rounded-md border p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {group.originalFileName}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {group.objects.length} objects / {formatBytes(group.size)}
                        </p>
                      </div>
                      {group.untrackedPaths.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={isDeletingStorage}
                          onClick={() => void handleDeleteUntracked(group.untrackedPaths)}
                        >
                          {isDeletingStorage ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            <Trash2Icon className="size-4" />
                          )}
                          Delete untracked
                        </Button>
                      )}
                    </div>
                    <div className="mt-3 space-y-2">
                      {group.objects.map((object) => (
                        <p
                          key={object.path}
                          className="truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                        >
                          {object.tracked ? "Tracked" : "Untracked"} / {object.path}
                        </p>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}

            {diagnostics.storage.untrackedObjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-medium text-muted-foreground">
                    Untracked Storage objects
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={isDeletingStorage}
                    onClick={() =>
                      void handleDeleteUntracked(
                        diagnostics.storage?.configured === false
                          ? []
                          : diagnostics.storage?.untrackedObjects.map((object) => object.path) ?? [],
                      )
                    }
                  >
                    {isDeletingStorage ? (
                      <Loader2Icon className="size-4 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-4" />
                    )}
                    Delete all untracked
                  </Button>
                </div>
                {diagnostics.storage.untrackedObjects.slice(0, 10).map((object) => (
                  <article key={object.path} className="rounded-md border p-3">
                    <p className="truncate text-sm font-medium">
                      {object.originalFileName ?? object.path}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {formatBytes(object.size)} / {object.path}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </div>
        )}
      </section>
    </section>
  )
}

export { AdminRoute }
