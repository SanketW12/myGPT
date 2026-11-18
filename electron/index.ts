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
let isZoomSharingActive = false;
let currentCptHostPid = '';
let autoHideOnShare = true; // Automatically hide window when screen sharing starts

/**
 * Configure Zoom desktop client preferences on macOS.
 * Sets `SetScreenCaptureMode` = "3" ("Advanced capture with window filtering").
 * In this mode, Zoom's ScreenCaptureKit pipeline honors `NSWindowSharingNone`
 * and hides the Electron window completely from Zoom screen sharing.
 */
function configureZoomCaptureMode() {
  if (process.platform !== 'darwin') return;
  try {
    const homeDir = app.getPath('home');
    const userConfigPath = join(homeDir, 'Library/Preferences/us.zoom.config.plist');
    execSync(`defaults write "${userConfigPath}" SetScreenCaptureMode -string "3" 2>/dev/null || true`);
    execSync(`plutil -replace PackageRecommend -xml '<dict><key>SetScreenCaptureMode</key><string>3</string></dict>' "${userConfigPath}" 2>/dev/null || true`);
    execSync(`defaults write us.zoom.xos SetScreenCaptureMode -string "3" 2>/dev/null || true`);
    console.log('✅ [MAIN] Zoom screen capture mode configured to Advanced Window Filtering (3)');
  } catch (err) {
    console.warn('⚠️ [MAIN] Note on Zoom plist config:', err);
  }
}

/**
 * Check if Zoom screen sharing is active by monitoring CptHost process.
 * Tracks PID changes to detect newly started meetings or screen shares immediately.
 */
function checkZoomScreenShare() {
  if (process.platform !== 'darwin') return;
  try {
    const pgrepOutput = execSync('pgrep -x CptHost 2>/dev/null || true').toString().trim();
    const isNowSharing = pgrepOutput.length > 0;

    // Detect when a new screen share or new meeting starts (PID changed or started)
    const shareStarted = isNowSharing && (pgrepOutput !== currentCptHostPid || !isZoomSharingActive);
    const shareStopped = !isNowSharing && isZoomSharingActive;

    currentCptHostPid = pgrepOutput;
    isZoomSharingActive = isNowSharing;

    if (shareStarted) {
      console.log(`🎥 [MAIN] Zoom screen share started (PID: ${pgrepOutput}) - Auto-hiding window for stealth protection`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (autoHideOnShare) {
          mainWindow.hide();
        }
        applyProtection(mainWindow);
        mainWindow.webContents.send('zoom-share-status', { isSharing: true });
      }
    } else if (shareStopped) {
      console.log('🎥 [MAIN] Zoom screen share stopped');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('zoom-share-status', { isSharing: false });
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Enforce OS-level window content protection.
 * On macOS: Sets NSWindowSharingNone, removing the window completely from all Zoom screen sharing modes, recordings, and screenshots.
 * On Windows: Sets WDA_EXCLUDEFROMCAPTURE, excluding the window from DWM capture pipelines.
 */
function applyProtection(win: BrowserWindow | null) {
  if (!win || win.isDestroyed()) return;
  try {
    win.setContentProtection(true);
    // On macOS, ensure the window is hidden from Mission Control / window pickers
    if (typeof (win as any).setHiddenInMissionControl === 'function') {
      (win as any).setHiddenInMissionControl(true);
    }
    // Explicitly disable native drop shadow on macOS so shadow buffer cannot leak into screen share
    if (process.platform === 'darwin' && typeof (win as any).setHasShadow === 'function') {
      (win as any).setHasShadow(false);
    }
  } catch (err) {
    console.error('❌ [MAIN] Error applying content protection:', err);
  }
}

async function createWindow() {
  // Ensure Zoom preferences are optimized for window filtering
  configureZoomCaptureMode();

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const initialX = Math.max(20, Math.floor(width - 720));
  // Create the browser window with show: false to prevent any initial flash during active screen share
  const window = new BrowserWindow({
    width: 700,
    height: 700,
    x: initialX, // Position around the right-center of screen
    y: 10, // At the top of the screen
    frame: false,
    show: false,
    resizable: true, // Allow user to resize and reduce the window size
    minWidth: 320,
    minHeight: 350,
    fullscreenable: false, // Prevent window from entering or attaching to full-screen spaces
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: false, // Explicitly managed below to avoid 'screen-saver' level forcing
    hasShadow: false, // Explicitly false: prevents macOS drop-shadow from leaking into Zoom screen share
    enableLargerThanScreen: true,
    roundedCorners: true,
    focusable: true,
    hiddenInMissionControl: true, // Hide from macOS Mission Control & window pickers
    skipTaskbar: true, // Hide from taskbar and application window switchers
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

  // 2. Set window level to 'floating'.
  // visibleOnFullScreen: false ensures macOS NEVER forcefully pulls this window onto a full-screen Zoom meeting or screen share.
  // skipTransformProcessType: true prevents macOS from altering process type and clearing NSWindowSharingNone.
  if (isAlwaysOnTop) {
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
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
  window.on('blur', () => applyProtection(window));
  window.on('move', () => applyProtection(window));
  window.on('resize', () => applyProtection(window));

  // Intercept macOS minimize event to cleanly hide window without leaving Dock thumbnail snapshot
  window.on('minimize', (event: any) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      window.hide();
    }
  });

  // Active Watchdog Guard: Continuously enforce content protection every 400ms.
  // Guarantees that whether joining new or existing Zoom calls, the window is immediately and perpetually hidden.
  const protectionInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(protectionInterval);
      return;
    }
    applyProtection(mainWindow);
  }, 400);

  // Monitor Zoom screen sharing host process (CptHost) every 300ms and notify renderer / auto-hide
  const zoomCheckInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      clearInterval(zoomCheckInterval);
      return;
    }
    checkZoomScreenShare();
  }, 300);

  // Check screen sharing on startup: if active, keep window hidden; otherwise safely reveal
  checkZoomScreenShare();
  if (isZoomSharingActive && autoHideOnShare) {
    console.log('🛡️ [MAIN] Screen sharing active on launch: Keeping window hidden for complete invisibility');
  } else {
    window.show();
    window.focus();
  }

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

  // Query Zoom screen sharing active status
  ipcMain.handle('get-zoom-share-status', () => isZoomSharingActive);

  // Auto-hide on screen share settings
  ipcMain.handle('get-auto-hide-on-share', () => autoHideOnShare);
  ipcMain.on('set-auto-hide-on-share', (_event, value: boolean) => {
    autoHideOnShare = value;
    console.log(`🛡️ [MAIN] set-auto-hide-on-share: ${autoHideOnShare}`);
  });

  // Toggle Always On Top (Pinned vs Background mode)
  ipcMain.handle('get-always-on-top', () => isAlwaysOnTop);

  ipcMain.on('toggle-always-on-top', (event) => {
    if (!window || window.isDestroyed()) return;
    isAlwaysOnTop = !isAlwaysOnTop;
    console.log(`📌 [MAIN] toggle-always-on-top: ${isAlwaysOnTop}`);
    if (isAlwaysOnTop) {
      window.setAlwaysOnTop(true, 'floating');
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
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
        // Keep window same size, elevate to 'floating'
        window.setAlwaysOnTop(true, 'floating');
      } else {
        // Restore user's configured alwaysOnTop state
        if (isAlwaysOnTop) {
          window.setAlwaysOnTop(true, 'floating');
          window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
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

  // Automatically enforce screen protection on any window created by Electron
  app.on('browser-window-created', (_, win) => {
    applyProtection(win);
  });

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

// let tray;

app.whenReady().then(() => {
  // const icon = nativeImage.createFromDataURL(
  //   'data:image/png;base64,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'
  // );
  // tray = new Tray(icon);
  // const contextMenu = Menu.buildFromTemplate([
  //   { label: 'Item1', type: 'radio' },
  //   { label: 'Item2', type: 'radio' },
  //   { label: 'Item3', type: 'radio', checked: true },
  //   { label: 'Item4', type: 'radio' }
  // ]);
  // tray.setToolTip('This is my application.');
  // tray.setContextMenu(contextMenu);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// listen the channel `message` and resend the received message to the renderer process
ipcMain.on('message', (event: IpcMainEvent, message: any) => {
  console.log(message);
  setTimeout(() => event.sender.send('message', 'common.hiElectron'), 500);
});
