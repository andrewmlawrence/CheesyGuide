import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const themeOptions = [
  { label: "Light", value: "light", Icon: SunIcon },
  { label: "Dark", value: "dark", Icon: MoonIcon },
  { label: "System", value: "system", Icon: MonitorIcon },
]

function ThemeMenu() {
  const { setTheme } = useTheme()

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" aria-label="Theme" />
              }
            >
              <SunIcon className="size-4 dark:hidden" />
              <MoonIcon className="hidden size-4 dark:block" />
            </DropdownMenuTrigger>
          }
        />
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        {themeOptions.map(({ label, value, Icon }) => (
          <DropdownMenuItem key={value} onClick={() => setTheme(value)}>
            <Icon className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThemeMenu }
