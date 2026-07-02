import { BookOpenIcon, LogOutIcon, SettingsIcon, UploadIcon } from "lucide-react"
import { NavLink, Outlet } from "react-router"

import team254Swoosh from "@/assets/team254-swoosh.png"
import team254SwooshWhite from "@/assets/team254-swoosh-white.png"
import { useSession } from "@/components/session-provider"
import { ThemeMenu } from "@/components/theme-menu"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Toaster } from "@/components/ui/sonner"

function RootLayout() {
  const { role, logout } = useSession()

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <NavLink
          to="/"
          className="inline-flex items-center gap-3 text-sm font-semibold text-foreground"
        >
          <span className="relative block h-7 w-[3.2rem]">
            <img
              src={team254Swoosh}
              alt="Team 254"
              className="h-7 w-auto dark:hidden"
            />
            <img
              src={team254SwooshWhite}
              alt="Team 254"
              className="hidden h-7 w-auto dark:block"
            />
          </span>
          <span className="inline-flex items-center gap-2">
            <BookOpenIcon className="size-4 text-primary" />
            CheesyGuide
          </span>
        </NavLink>
        <div className="flex items-center gap-1 sm:gap-2">
          {role && (
            <NavLink
              to="/"
              className="hidden rounded-md px-2 py-1 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              Knowledgebase
            </NavLink>
          )}
          {role === "mentor" && (
            <>
              <NavLink
                to="/mentor"
                className="inline-flex rounded-md p-2 text-muted-foreground hover:text-foreground sm:gap-1 sm:px-2 sm:py-1 sm:text-sm"
                aria-label="Mentor"
              >
                <UploadIcon className="size-4" />
                <span className="hidden sm:inline">Mentor</span>
              </NavLink>
              <NavLink
                to="/admin"
                className="inline-flex rounded-md p-2 text-muted-foreground hover:text-foreground sm:gap-1 sm:px-2 sm:py-1 sm:text-sm"
                aria-label="Admin"
              >
                <SettingsIcon className="size-4" />
                <span className="hidden sm:inline">Admin</span>
              </NavLink>
            </>
          )}
          <ThemeMenu />
          {role && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => void logout()}
            >
              <LogOutIcon className="size-4" />
            </Button>
          )}
        </div>
      </header>
      <Separator />
      <main>
        <Outlet />
      </main>
      <Toaster position="top-left" closeButton richColors />
    </div>
  )
}

export { RootLayout }
