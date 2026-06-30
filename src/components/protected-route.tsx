import { Loader2Icon, LockIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Navigate } from "react-router"

import { useSession } from "@/components/session-provider"

function ProtectedRoute({
  children,
  mentorOnly = false,
}: {
  children: ReactNode
  mentorOnly?: boolean
}) {
  const { isLoading, role } = useSession()

  if (isLoading) {
    return (
      <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="size-4 animate-spin" />
        Checking access
      </div>
    )
  }

  if (!role) {
    return <Navigate to="/login" replace />
  }

  if (mentorOnly && role !== "mentor") {
    return (
      <section className="mx-auto flex min-h-[calc(100svh-4rem)] max-w-md flex-col items-start justify-center gap-4 px-6">
        <LockIcon className="size-5 text-muted-foreground" />
        <div className="space-y-2">
          <h1 className="text-2xl font-medium">Mentor access required</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with the mentor password to use this area.
          </p>
        </div>
        <a
          href="/login"
          className="inline-flex h-8 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Go to login
        </a>
      </section>
    )
  }

  return children
}

export { ProtectedRoute }
