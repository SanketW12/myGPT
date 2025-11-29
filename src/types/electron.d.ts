export interface IElectronAPI {
  sendMessage: (message: string) => void;
  Minimize: () => void;
  Maximize: () => void;
  Close: () => void;
  removeLoading: () => void;
  handleDirection: (direction: string) => void;
  on: (channel: string, callback: (data: any) => void) => void;
  getDesktopSources: () => Promise<Array<{ id: string; name: string }>>;
}

declare global {
  interface Window {
    Main: IElectronAPI;
    ipcRenderer: any;
  }
}
