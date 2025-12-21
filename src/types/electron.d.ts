export interface IElectronAPI {
  sendMessage: (message: string) => void;
  Minimize: () => void;
  Maximize: () => void;
  Close: () => void;
  removeLoading: () => void;
  handleDirection: (direction: string) => void;
  on: (channel: string, callback: (data: any) => void) => void;
  getDesktopSources: (options?: { fetchThumbnail?: boolean; thumbnailSize?: { width: number; height: number } }) => Promise<Array<{ id: string; name: string; thumbnail?: string }>>;
  setCaptureMode: (isCaptureMode: boolean) => void;
}

declare global {
  interface Window {
    Main: IElectronAPI;
    ipcRenderer: any;
  }
}
