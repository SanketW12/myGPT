// Native
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

let fnListenerProcess: ChildProcess | null = null;

function startFnListener(win: BrowserWindow) {
  if (process.platform !== 'darwin') return;

  const binPath = join(__dirname, 'fn-listener');
  const srcPath = join(__dirname, '../electron/native/fn-listener.m');

  try {
    if (!existsSync(binPath) && existsSync(srcPath)) {
      console.log('🔨 [MAIN] Compiling fn-listener native helper...');
      execSync(`clang -O2 -framework Cocoa -framework IOKit "${srcPath}" -o "${binPath}"`);
      console.log('✅ [MAIN] fn-listener compiled successfully');
    }

    if (existsSync(binPath)) {
      console.log('🚀 [MAIN] Spawning fn-listener process:', binPath);
      fnListenerProcess = spawn(binPath, [], { stdio: ['ignore', 'pipe', 'ignore'] });

      fnListenerProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        if (text.includes('FN_PRESS')) {
          console.log('🎤 [MAIN] Fn key press detected, notifying renderer...');
          win.webContents.send('fn-key-pressed');
        }
      });

      fnListenerProcess.on('exit', (code, signal) => {
        console.log(`⚠️ [MAIN] fn-listener exited with code: ${code}, signal: ${signal}`);
        fnListenerProcess = null;
      });
    } else {
      console.warn('⚠️ [MAIN] fn-listener binary not found at:', binPath);
    }
  } catch (err) {
    console.error('❌ [MAIN] Error starting fn-listener:', err);
  }
}

// Packages
import {
  BrowserWindow,
  app,
  ipcMain,
  IpcMainEvent,
  nativeTheme,
  screen,
  desktopCapturer,
  systemPreferences,
  session,
  globalShortcut
} from 'electron';
import isDev from 'electron-is-dev';

// Enable native system audio loopback capture flags for Chromium / Electron on macOS
app.commandLine.appendSwitch(
  'enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
);

let mainWindow: BrowserWindow | null = null;
let isAlwaysOnTop = true; // Pin state: floating overlay vs background mode

/**
 * Enforce OS-level window content protection.
 * On macOS: Sets NSWindowSharingNone, removing the window from screen sharing, recordings, and screenshots.
 * On Windows: Sets WDA_EXCLUDEFROMCAPTURE, excluding the window from DWM capture pipelines.
 */
function applyProtection(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setContentProtection(true);
    console.log('🛡️ [MAIN] Content protection enforced: window excluded from screen capture/sharing');
  } catch (err) {
    console.error('❌ [MAIN] Error applying content protection:', err);
  }
}

async function createWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const initialX = Math.max(20, Math.floor(width - 720));
  // Create the browser window.
  const window = new BrowserWindow({
    width: 700,
    height: 700,
    x: initialX, // Position around the right-center of screen
    y: 10, // At the top of the screen
    frame: false,
    show: true,
    resizable: true, // Allow user to resize and reduce the window size
    minWidth: 320,
    minHeight: 350,
    fullscreenable: false, // Prevent window from entering or attaching to full-screen spaces
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false, // Explicitly managed below to avoid 'screen-saver' level forcing
    hasShadow: true,
    enableLargerThanScreen: true,
    roundedCorners: true,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), // Use .cjs
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // Disable sandbox in development
      webSecurity: false // Disable web security in development
    }
  });

  mainWindow = window;

  const preloadPath = join(__dirname, 'preload.cjs');
  console.log('🔧 [MAIN] Preload path:', preloadPath);
  console.log('🔧 [MAIN] __dirname:', __dirname);

  // Check if preload file exists
  const fs = await import('fs');
  const preloadExists = fs.existsSync(preloadPath);
  console.log('🔧 [MAIN] Preload file exists:', preloadExists);
  if (!preloadExists) {
    console.error('❌ [MAIN] Preload file NOT FOUND at:', preloadPath);
  }

  // 1. Enforce content protection immediately on creation
  applyProtection(window);

  // 2. Set window level to 'floating' instead of 'screen-saver'.
  // 'screen-saver' level forces the window into presentation/screen-share buffers and onto all full-screen spaces.
  // 'floating' keeps it neatly on top of normal windows without hijacking presentation/screen-share buffers.
  // visibleOnFullScreen: false ensures macOS NEVER forcefully pulls this window onto a full-screen Zoom meeting or screen share.
  if (isAlwaysOnTop) {
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  } else {
    window.setAlwaysOnTop(false);
    window.setVisibleOnAllWorkspaces(false);
  }

  // Check permissions on macOS
  if (process.platform === 'darwin') {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log('🎤 [MAIN] Microphone access status:', micStatus);

    const screenStatus = systemPreferences.getMediaAccessStatus('screen');
    console.log('🖥️ [MAIN] Screen recording access status:', screenStatus);

    if (micStatus !== 'granted') {
      // This might trigger a system prompt
      systemPreferences.askForMediaAccess('microphone').then((granted: boolean) => {
        console.log('🎤 [MAIN] Microphone access requested. Granted:', granted);
      });
    }
  }

  // Re-assert protection on key lifecycle events to prevent OS compositors from clearing it
  window.once('ready-to-show', () => {
    applyProtection(window);
  });

  window.webContents.on('did-finish-load', () => {
    console.log('✅ [MAIN] Page finished loading');
    applyProtection(window);
  });

  window.on('show', () => applyProtection(window));
  window.on('restore', () => applyProtection(window));
  window.on('focus', () => applyProtection(window));

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('❌ [MAIN] Preload error:', { preloadPath, error });
  });

  const port = process.env.PORT || 5421;
  const url = isDev ? `http://localhost:${port}` : join(__dirname, './dist-vite/index.html');

  // and load the index.html of the app.
  if (isDev) {
    window?.loadURL(url);
  } else {
    window?.loadFile(url);
  }

  // Start Fn key hardware listener on macOS
  startFnListener(window);

  // Open the DevTools.
  // window.webContents.openDevTools();

  ipcMain.on('move-window', (_event, direction) => {
    if (!window) return;
    // console.log(direction);
    // window.setBounds({ x: 0, y: 0, width: 400, height: 400 });
    const { x, y } = window.getBounds();

    // // Adjust the movement step size
    const step = 150;

    // console.log(x, y, direction);

    switch (direction) {
      case 'left':
        window.setBounds({ x: x - step, y });
        break;
      case 'right':
        window.setBounds({ x: x + step, y });
        break;
      case 'up':
        window.setBounds({ x, y: y - step });
        break;
      case 'down':
        window.setBounds({ x, y: y + step });
        break;

      default:
    }
  });

  // For window controls & resizing
  ipcMain.on('minimize', () => {
    if (!window || window.isDestroyed()) return;
    if (process.platform === 'darwin') {
      // On macOS, transparent frameless windows don't minimize properly to Dock
      // and can be restored unintentionally during space / screen-share switches.
      // Cleanly hiding the window completely removes it from screen and all capture pipelines.
      if (window.isVisible()) {
        window.hide();
      } else {
        window.show();
        window.focus();
        applyProtection(window);
      }
    } else {
      window.isMinimized() ? window.restore() : window.minimize();
      applyProtection(window);
    }
  });

  ipcMain.on('maximize', () => {
    if (!window || window.isDestroyed()) return;
    window.isMaximized() ? window.restore() : window.maximize();
    applyProtection(window);
  });

  ipcMain.on('close', () => {
    if (!window || window.isDestroyed()) return;
    window.close();
  });

  // Toggle Always On Top (Pinned vs Background mode)
  ipcMain.handle('get-always-on-top', () => isAlwaysOnTop);

  ipcMain.on('toggle-always-on-top', (event) => {
    if (!window || window.isDestroyed()) return;
    isAlwaysOnTop = !isAlwaysOnTop;
    console.log(`📌 [MAIN] toggle-always-on-top: ${isAlwaysOnTop}`);
    if (isAlwaysOnTop) {
      window.setAlwaysOnTop(true, 'floating');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    } else {
      window.setAlwaysOnTop(false);
      window.setVisibleOnAllWorkspaces(false);
    }
    applyProtection(window);
    event?.sender?.send('always-on-top-changed', { isAlwaysOnTop });
  });

  // Toggle Stealth / Hide mode
  ipcMain.on('toggle-stealth', () => {
    if (!window || window.isDestroyed()) return;
    if (window.isVisible()) {
      window.hide();
    } else {
      window.show();
      window.focus();
      applyProtection(window);
    }
  });

  // Drag window via cursor movement
  ipcMain.on('drag-window', (_event, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    if (!window) return;
    const { x, y } = window.getBounds();
    window.setPosition(Math.round(x + deltaX), Math.round(y + deltaY));
  });

  // Resize window by delta (e.g. from corner resize grip)
  ipcMain.on('resize-window', (event, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
    if (!window) return;
    const { width: currentW, height: currentH } = window.getBounds();
    const newWidth = Math.max(320, Math.round(currentW + deltaX));
    const newHeight = Math.max(350, Math.round(currentH + deltaY));
    window.setSize(newWidth, newHeight);
    applyProtection(window);
    const isCompact = newWidth <= 450;
    event?.sender?.send('window-size-changed', { isCompact, width: newWidth, height: newHeight });
  });

  // Explicitly set window dimensions
  ipcMain.on('set-window-size', (event, { width: newW, height: newH }: { width: number; height: number }) => {
    if (!window) return;
    const w = Math.max(320, Math.round(newW));
    const h = Math.max(350, Math.round(newH));
    window.setSize(w, h);
    applyProtection(window);
    const isCompact = w <= 450;
    event?.sender?.send('window-size-changed', { isCompact, width: w, height: h });
  });

  // Toggle between standard (700x700) and compact reduced size (380x520)
  let isCompact = false;
  ipcMain.on('toggle-window-size', (event) => {
    if (!window) return;
    const bounds = window.getBounds();
    if (bounds.width > 450) {
      window.setSize(380, 520);
      isCompact = true;
    } else {
      window.setSize(700, 700);
      isCompact = false;
    }
    applyProtection(window);
    event?.sender?.send('window-size-changed', { isCompact, width: window.getBounds().width, height: window.getBounds().height });
  });

  ipcMain.handle('get-window-bounds', () => {
    if (!window) return { width: 700, height: 700, x: 0, y: 0 };
    return window.getBounds();
  });

  ipcMain.on('set-capture-mode', (_event, isCaptureMode) => {
    if (!window || window.isDestroyed()) return;
    console.log(`🖥️ [MAIN] set-capture-mode: ${isCaptureMode} (Window size preserved)`);
    try {
      if (isCaptureMode) {
        // Keep window same size, elevate to 'floating' (safe overlay, not screen-saver)
        window.setAlwaysOnTop(true, 'floating');
      } else {
        // Restore user's configured alwaysOnTop state
        if (isAlwaysOnTop) {
          window.setAlwaysOnTop(true, 'floating');
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
        } else {
          window.setAlwaysOnTop(false);
          window.setVisibleOnAllWorkspaces(false);
        }
      }
      applyProtection(window);
      console.log('✅ [MAIN] Window capture mode state updated');
    } catch (err) {
      console.error('❌ [MAIN] Error changing window capture mode:', err);
    }
  });

  nativeTheme.themeSource = 'dark';
}

ipcMain.handle(
  'get-desktop-sources',
  async (_event, options?: { fetchThumbnail?: boolean; thumbnailSize?: Electron.Size }) => {
    console.log('🎯 [MAIN] get-desktop-sources handler called with options:', options);
    try {
      console.log('📡 [MAIN] Requesting desktop sources with types: [screen]');
      // Use larger thumbnail size if not specified but fetching thumbnail
      const thumbnailSize = options?.thumbnailSize || { width: 1080, height: 720 };
      const fetchThumbnail = options?.fetchThumbnail || false;

      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: fetchThumbnail ? thumbnailSize : { width: 0, height: 0 }
      });

      console.log(
        `✅ [MAIN] Found ${sources.length} sources:`,
        sources.map((s) => ({ id: s.id, name: s.name }))
      );

      const result = sources.map((source) => ({
        id: source.id,
        name: source.name,
        // Only include thumbnail if requested to avoid overhead
        thumbnail: fetchThumbnail ? source.thumbnail.toDataURL() : undefined
      }));

      console.log(`📤 [MAIN] Returning sources to renderer. Thumbnails included: ${fetchThumbnail}`);
      return result;
    } catch (error) {
      console.error('❌ [MAIN] Error getting desktop sources:', error);
      throw error;
    }
  }
);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Handle display media requests to capture system / speaker output audio (loopback)
  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then((sources) => {
        const screenSource =
          sources.find((s) => s.name.includes('Screen') || s.name.includes('Entire Screen')) || sources[0];
        console.log('🔊 [MAIN] setDisplayMediaRequestHandler routed to screen source:', screenSource?.name);
        callback({
          video: screenSource,
          audio: 'loopback'
        });
      })
      .catch((err) => {
        console.error('❌ [MAIN] Error in setDisplayMediaRequestHandler:', err);
        callback({ video: null as any, audio: null as any });
      });
  });

  // Automatically approve media & display-capture permission requests
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'display-capture' || permission === 'media') {
      callback(true);
      return;
    }
    callback(true);
  });

  session.defaultSession.setPermissionCheckHandler(() => true);

  createWindow();

  // Register global stealth hotkey to toggle app visibility anywhere (Cmd+Option+H on macOS, Ctrl+Alt+H on Windows/Linux)
  const toggleShortcut = process.platform === 'darwin' ? 'Command+Option+H' : 'Control+Alt+H';
  const registered = globalShortcut.register(toggleShortcut, () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isVisible()) {
      console.log('👁️ [MAIN] Global stealth hotkey triggered - Hiding window');
      mainWindow.hide();
    } else {
      console.log('👁️ [MAIN] Global stealth hotkey triggered - Showing window');
      mainWindow.show();
      mainWindow.focus();
      applyProtection(mainWindow);
    }
  });
  console.log(`⌨️ [MAIN] Global stealth hotkey (${toggleShortcut}) registered: ${registered}`);

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
      applyProtection(mainWindow);
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (fnListenerProcess) {
    try {
      fnListenerProcess.kill();
    } catch {
      // ignore
    }
    fnListenerProcess = null;
  }
});



// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// listen the channel `message` and resend the received message to the renderer process
ipcMain.on('message', (event: IpcMainEvent, message: any) => {
  console.log(message);
  setTimeout(() => event.sender.send('message', 'common.hiElectron'), 500);
});
