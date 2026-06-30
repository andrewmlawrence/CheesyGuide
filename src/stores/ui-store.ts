import { create } from "zustand"

type UiState = {
  isSidebarOpen: boolean
  activePanel: string | null
  setActivePanel: (panel: string | null) => void
  setSidebarOpen: (open: boolean) => void
  toggleSidebar: () => void
}

export const useUiStore = create<UiState>((set) => ({
  isSidebarOpen: false,
  activePanel: null,
  setActivePanel: (activePanel) => set({ activePanel }),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
  toggleSidebar: () =>
    set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}))
