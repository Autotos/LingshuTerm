import { create } from 'zustand';

export type SidebarTab = 'sessions' | 'tasks';

interface UiState {
  sidebarCollapsed: boolean;
  /** Whether the right-side editor drawer is open. */
  isEditorVisible: boolean;
  sidebarTab: SidebarTab;
  settingsOpen: boolean;
  /** Whether the "New Session" modal (SessionTypeModal) is visible. */
  sessionModalOpen: boolean;
  /** Whether the Session Manager right panel is visible. */
  isSessionManagerVisible: boolean;
  /** Whether the "New Terminal" connection config modal is visible. */
  terminalModalOpen: boolean;
  /** Which session the terminal modal should add the terminal to. */
  terminalModalSessionId: string | null;
  toggleSidebar: () => void;
  toggleEditor: () => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setSettingsOpen: (open: boolean) => void;
  openCreateSessionModal: () => void;
  closeCreateSessionModal: () => void;
  toggleSessionManager: () => void;
  openTerminalModal: (sessionId: string) => void;
  closeTerminalModal: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: false,
  isEditorVisible: false,
  sidebarTab: 'sessions',
  settingsOpen: false,
  sessionModalOpen: false,
  isSessionManagerVisible: false,
  terminalModalOpen: false,
  terminalModalSessionId: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleEditor: () => set((s) => ({ isEditorVisible: !s.isEditorVisible })),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openCreateSessionModal: () => set({ sessionModalOpen: true }),
  closeCreateSessionModal: () => set({ sessionModalOpen: false }),
  toggleSessionManager: () =>
    set((s) => ({ isSessionManagerVisible: !s.isSessionManagerVisible })),
  openTerminalModal: (sessionId) =>
    set({ terminalModalOpen: true, terminalModalSessionId: sessionId }),
  closeTerminalModal: () =>
    set({ terminalModalOpen: false, terminalModalSessionId: null }),
}));
