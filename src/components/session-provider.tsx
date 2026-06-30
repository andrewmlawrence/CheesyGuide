import { useAction, useMutation, useQuery } from "convex/react"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"

import { api } from "@/lib/convex"

type Role = "student" | "mentor"

type StoredSession = {
  sessionToken: string
  role: Role
}

type SessionContextValue = {
  isLoading: boolean
  role: Role | null
  sessionToken: string | null
  login: (password: string) => Promise<Role>
  logout: () => Promise<void>
}

const STORAGE_KEY = "cheesyguide-session"
const SessionContext = createContext<SessionContextValue | null>(null)

function readStoredSession(): StoredSession | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    return JSON.parse(raw) as StoredSession
  } catch {
    window.localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function SessionProvider({ children }: { children: ReactNode }) {
  const loginAction = useAction(api.auth.login)
  const logoutMutation = useMutation(api.auth.logout)
  const [storedSession, setStoredSession] = useState<StoredSession | null>(() =>
    typeof window === "undefined" ? null : readStoredSession(),
  )
  const viewer = useQuery(
    api.auth.viewer,
    storedSession ? { sessionToken: storedSession.sessionToken } : "skip",
  )

  useEffect(() => {
    if (storedSession && viewer === null) {
      window.localStorage.removeItem(STORAGE_KEY)
      setStoredSession(null)
    }
  }, [storedSession, viewer])

  const value = useMemo<SessionContextValue>(
    () => ({
      isLoading: Boolean(storedSession && viewer === undefined),
      role: viewer?.role ?? storedSession?.role ?? null,
      sessionToken: storedSession?.sessionToken ?? null,
      async login(password) {
        const session = await loginAction({ password })
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
        setStoredSession(session)
        return session.role
      },
      async logout() {
        if (storedSession) {
          await logoutMutation({ sessionToken: storedSession.sessionToken })
        }
        window.localStorage.removeItem(STORAGE_KEY)
        setStoredSession(null)
      },
    }),
    [loginAction, logoutMutation, storedSession, viewer],
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

function useSession() {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error("useSession must be used within SessionProvider")
  }
  return context
}

export { SessionProvider, useSession }
