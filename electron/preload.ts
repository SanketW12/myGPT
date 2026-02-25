const { ipcRenderer, contextBridge } = require('electron');

// Use a simple any cast for global state in preload
const myGlobal = globalThis as any;

console.log('🚀 [PRELOAD] Preload script starting (CJS Edition)...');

const api = {
  sendMessage: (message: string) => {
    ipcRenderer.send('message', message);
  },
  Minimize: () => {
    ipcRenderer.send('minimize');
  },
  Maximize: () => {
    ipcRenderer.send('maximize');
  },
  Close: () => {
    ipcRenderer.send('close');
  },
  removeLoading: () => {
    if (myGlobal._removeLoading) myGlobal._removeLoading();
  },
  handleDirection: (direction: string) => {
    ipcRenderer.send('move-window', direction);
  },
  on: (channel: string, callback: (data: any) => void) => {
    ipcRenderer.on(channel, (_: any, data: any) => callback(data));
  },
  getDesktopSources: async (options?: { fetchThumbnail?: boolean; thumbnailSize?: { width: number; height: number } }) => {
    console.log('🔌 [PRELOAD] getDesktopSources called via Main API');
    return ipcRenderer.invoke('get-desktop-sources', options);
  },
  setCaptureMode: (isCaptureMode: boolean) => {
    ipcRenderer.send('set-capture-mode', isCaptureMode);
  }
};

try {
  contextBridge.exposeInMainWorld('Main', api);
  contextBridge.exposeInMainWorld('ipcRenderer', ipcRenderer);
  console.log('✅ [PRELOAD] Main API exposed successfully');
} catch (e) {
  console.error('❌ [PRELOAD] Failed to expose API:', e);
}

// --- Loading Screen Logic ---
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise((resolve) => {
    if (condition.includes(document.readyState)) {
      resolve(true);
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true);
        }
      });
    }
  });
}

function useLoading() {
  const className = `loaders-css__square-spin`;
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `;
  const oStyle = document.createElement('style');
  const oDiv = document.createElement('div');

  oStyle.id = 'app-loading-style';
  oStyle.innerHTML = styleContent;
  oDiv.className = 'app-loading-wrap';
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`;

  return {
    appendLoading: function() {
      document.head.appendChild(oStyle);
      document.body.appendChild(oDiv);
    },
    removeLoading: function() {
      if (document.head.contains(oStyle)) document.head.removeChild(oStyle);
      if (document.body.contains(oDiv)) document.body.removeChild(oDiv);
    },
  };
}

domReady().then(() => {
  const { appendLoading, removeLoading } = useLoading();
  myGlobal._removeLoading = removeLoading;
  appendLoading();
  
  window.onmessage = (ev) => {
    ev.data.payload === 'removeLoading' && removeLoading();
  };
  
  setTimeout(removeLoading, 1000);
});
