import { create } from 'zustand';

export type ActiveView = 'terminal' | 'blocks' | 'editor';
export type SidebarTab = 'sessions' | 'tasks';

interface UiState {
  sidebarCollapsed: boolean;
  activeView: ActiveView;
  sidebarTab: SidebarTab;
  settingsOpen: boolean;
  /** Whether the "New Session" modal (SessionTypeModal) is visible. */
  sessionModalOpen: boolean;
  /** Whether the Session Manager right panel is visible. */
  isSessionManagerVisible: boolean;
  toggleSidebar: () => void;
  setActiveView: (view: ActiveView) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSettingsOpen: (open: boolean) => void;
  openCreateSessionModal: () => void;
  closeCreateSessionModal: () => void;
  toggleSessionManager: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  activeView: 'terminal',
  sidebarTab: 'sessions',
  settingsOpen: false,
  sessionModalOpen: false,
  isSessionManagerVisible: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setActiveView: (view) => set({ activeView: view }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openCreateSessionModal: () => set({ sessionModalOpen: true }),
  closeCreateSessionModal: () => set({ sessionModalOpen: false }),
  toggleSessionManager: () =>
    set((s) => ({ isSessionManagerVisible: !s.isSessionManagerVisible })),
}));
