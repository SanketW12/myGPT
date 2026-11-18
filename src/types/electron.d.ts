export interface IElectronAPI {
  sendMessage: (message: string) => void;
  Minimize: () => void;
  Maximize: () => void;
  Close: () => void;
  removeLoading: () => void;
  handleDirection: (direction: string) => void;
  on: (channel: string, callback: (data: any) => void) => (() => void) | void;
  getDesktopSources: (options?: { fetchThumbnail?: boolean; thumbnailSize?: { width: number; height: number } }) => Promise<Array<{ id: string; name: string; thumbnail?: string }>>;
  setCaptureMode: (isCaptureMode: boolean) => void;
  dragWindow?: (deltaX: number, deltaY: number) => void;
  resizeWindow?: (deltaX: number, deltaY: number) => void;
  setWindowSize?: (width: number, height: number) => void;
  toggleWindowSize?: () => void;
  getWindowBounds?: () => Promise<{ width: number; height: number; x: number; y: number }>;
  toggleAlwaysOnTop?: () => void;
  getAlwaysOnTop?: () => Promise<boolean>;
  toggleStealth?: () => void;
}

declare global {
  interface Window {
    Main: IElectronAPI;
    ipcRenderer: any;
  }
}
