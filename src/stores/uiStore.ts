import { create } from 'zustand';

export type SidebarTab = 'sessions' | 'tasks';

interface UiState {
  sidebarCollapsed: boolean;
  /** Current sidebar width in px (when expanded). Default 260, min 200, max 500. */
  sidebarWidth: number;
  /** Current output panel height in px (when expanded). Default 200, min 100, max 600. */
  outputHeight: number;
  /** Whether the right-side editor drawer is open. */
  isEditorVisible: boolean;
  /** Whether the right-side SFTP file explorer is open. */
  isSftpVisible: boolean;
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
  setSidebarWidth: (width: number) => void;
  setOutputHeight: (height: number) => void;
  toggleEditor: () => void;
  toggleSftp: () => void;
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
  sidebarWidth: 260,
  outputHeight: 350,
  isEditorVisible: false,
  isSftpVisible: false,
  sidebarTab: 'sessions',
  settingsOpen: false,
  sessionModalOpen: false,
  isSessionManagerVisible: false,
  terminalModalOpen: false,
  terminalModalSessionId: null,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),
  setOutputHeight: (height) => set({ outputHeight: height }),
  toggleEditor: () => set((s) => ({ isEditorVisible: !s.isEditorVisible })),
  toggleSftp: () => set((s) => ({ isSftpVisible: !s.isSftpVisible })),
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
