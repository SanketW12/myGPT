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
  session
} from 'electron';
import isDev from 'electron-is-dev';

// Enable native system audio loopback capture flags for Chromium / Electron on macOS
app.commandLine.appendSwitch(
  'enable-features',
  'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride'
);

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
    fullscreenable: true,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
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

  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Hide window from screen capture/sharing
  window.setContentProtection(true);
  // window.webContents.openDevTools();

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

  // Log when preload script should have loaded
  window.webContents.on('did-finish-load', () => {
    console.log('✅ [MAIN] Page finished loading');
  });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('❌ [MAIN] Preload error:', { preloadPath, error });
  });
  // window.setContentProtection(true);
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
    // eslint-disable-next-line no-unused-expressions
    window.isMinimized() ? window.restore() : window.minimize();
    // or alternatively: win.isVisible() ? win.hide() : win.show()
  });
  ipcMain.on('maximize', () => {
    // eslint-disable-next-line no-unused-expressions
    window.isMaximized() ? window.restore() : window.maximize();
  });

  ipcMain.on('close', () => {
    window.close();
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
    const isCompact = newWidth <= 450;
    event?.sender?.send('window-size-changed', { isCompact, width: newWidth, height: newHeight });
  });

  // Explicitly set window dimensions
  ipcMain.on('set-window-size', (event, { width: newW, height: newH }: { width: number; height: number }) => {
    if (!window) return;
    const w = Math.max(320, Math.round(newW));
    const h = Math.max(350, Math.round(newH));
    window.setSize(w, h);
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
    event?.sender?.send('window-size-changed', { isCompact, width: window.getBounds().width, height: window.getBounds().height });
  });

  ipcMain.handle('get-window-bounds', () => {
    if (!window) return { width: 700, height: 700, x: 0, y: 0 };
    return window.getBounds();
  });

  ipcMain.on('set-capture-mode', (_event, isCaptureMode) => {
    if (!window) return;
    console.log(`🖥️ [MAIN] set-capture-mode: ${isCaptureMode} (Window size preserved)`);
    try {
      if (isCaptureMode) {
        // Keep window same size, just ensure it's on top for the selection process
        window.setAlwaysOnTop(true, 'screen-saver');
        console.log('✅ [MAIN] Window kept at current size for selection');
      } else {
        // Keep it always on top even after capture
        window.setAlwaysOnTop(true, 'screen-saver');
        console.log('✅ [MAIN] Window capture mode finished');
      }
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

  app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
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
  //   'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAAAXNSR0IArs4c6QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAVlpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDUuNC4wIj4KICAgPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4KICAgICAgPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIKICAgICAgICAgICAgeG1sbnM6dGlmZj0iaHR0cDovL25zLmFkb2JlLmNvbS90aWZmLzEuMC8iPgogICAgICAgICA8dGlmZjpPcmllbnRhdGlvbj4xPC90aWZmOk9yaWVudGF0aW9uPgogICAgICA8L3JkZjpEZXNjcmlwdGlvbj4KICAgPC9yZGY6UkRGPgo8L3g6eG1wbWV0YT4KTMInWQAACsZJREFUWAmtWFlsXFcZ/u82++Jt7IyT2Em6ZFHTpAtWIzspEgjEUhA8VNAiIYEQUvuABBIUwUMkQIVKPCIoEiABLShISEBbhFJwIGRpIKRpbNeJ7bh2HHvssR3PPnPnLnzfmRlju6EQqUc+c++c8y/fv54z1uQOh+/7Glh0TD59TE/TND7lnfa4/64OKsM071QoeZpA/y9WWvk/B4XCC06TUC+Xyw8HTXNQ1+Ww6PpOrMebewXxvBueJ6/XHOdMJBL5J9Y97m2R0SS/wweE6JxkGx5dilWr1S/7dXsEa2o4+LyFmcFcaL5zbX3Y9gh5hpeWYpSB9XV5/H678V89BGYDXnHJlCsWn4gHrGc1K9CXxferOdvPOOKUfF8cH7nUyCtklQZXih/VNNlmirk3GdBSoIcRswW7/vVkLPYi5W2Uze8bh7J+4wLfh4dViFx5/nmrUi7/MhGNvrCkBfpeWqnW/7BUdadqntQ8zwr6vhUV34xpYnDynWvcmwQNaclDXsqgLMqkocPDw7fNx7d5qIX+/PmJxKGD6VdDkeh7ztyqOFfrokGCEWiiZ1mp0uITnuKAosaT7+pNxMYTyefutcQfbA+b1XLpH5fnF97/yD335Fu6mqTqsclDINBVmI4fDxw80KPAvJSt1MZtMcLiGxYUu83p4UkgnJZlqcl3LAj3WnTkIS9lUBYNPJjueVWgg7qocyOgliFqjZsg8gq5tRdiieQTf1gq15Y8CUbRZtyWOzZwc8lEqS3PTCtgqd13ieO68BQ2uNl64tXAewktrFuX2mPdkWAxn3sxnmx7sqUTJGqso8MGS9tbXFz8DMH8bblUX3T9QARVi8RV8qljfcJy0zRlaf6mzHEuzEtmekqCoZB4rqp0OmudHtUnlEWZlE0d1EWd1N3EozourcO65pw4eTIZQTW9VazJtbqvw9XwKVFQMsKDBuNhtp4uvGGFI+IDgKnpMjYyIis3ZsQMBIR7pONsIaMsyqRs6ohY1rPUSd3EQFDqo+kdZ3Fh4aupbdu+99uFQr2A1CBs4uEAjZjIFUMHi4dVxMXzCdCXQj4vBrwVCofl0ulTcv/DAxJJJBUPc8mpoyI2JDw7bFyT+ifTcSubyXytJ51+roWBxwG9Q73WWjZ7eSUU3//nXM0NI+x0PBGrTSgsLS9JFuFxHFrvSqIrJV279gi6tjiVspTza3JjZhY+0CQZj0mlWJSeHTslCro6eFqymCcVVN77kkGjs1p4sy2VOoSlOrFwT+XR+PjkgGaZ+ycKVbRTYUdVrmaImCvzk1dlFCEJdHRJ284+ie/ol0h7p7jFvExcvCCXzp2Rqem3pAMAiqWS6JGYhFI9Mjo6KjevXVUyKEuFHrKpY6JQ8TXT3D8+OTkAHBw6o6LCFo9ag3o4JtlCyTHEt5AxKvS6YUi5kJeZG3Py0NAxlLcJ9xti+K7Mjo/JfGZRuvv6Ze+9+yWEhDZAvzg3JyhX2d6/S7q6e+TimdOS7ElLKBZDwqvmj6rztayr1fVI1IoXi4PAcYZY1tPEEO1wEVlXgRFBDcmIXTqJsS+XyhKLJ5A/OpIVXXptWUYv/UvaenfIocEhMQ2EzHHErlXFCgQl3paU1eVl6QAY8sQTCSmVihKJx1V/ogvgIYF/pACdcMBhqONoHhF88/2d+bojyA6cRvje2IdFjoSjUSnBS8hgyS9lZOzKFdmPxO3o6gQIGzwuDn1dVSCtCKPy1pZXlATXqUsVYMLRmKo87vP4Y1ioqwCdCegmMYx3W/VPn8RrSDwwIMMbcEjkYo29JZVOy+ybI7K4eksODx1VSqvligpReSVLgySM/FI5h2q062jNyL3s7FtoAyGJIlx1225UmwJF6aJRJ3XzHXO9bWvsJa3jQFlBJkz6iuXdu32HzM7MyP0PPNgAU6ko4Qzp6b+flr8MD9OYJg9CwtzL5+T65ITs2bsP3mGxN/ZbBcOn0sk20gAkLQ+huXpFi8vkoY9AoyDjxTR1mbo6Ltt275HpN0dlNxQE40mVM8Ajjxx9VAGhAvQR1akZFCq799ADysMuQqOxh2FNmamEaz51ItGLfFD9+oUJoZkLowHoFA2mljUacqOMflKuVmHpfmnfvlMuvXZeStmMBIMhcWEdjgFJtrUjXI0KchAuAg0ilxLJNoRVBxhIBm0TjjKAuqjTqTs3CQZ6QUUMGFW7eiWMUg6w+yo8YMW7DqtqlZLkUDV2ISfd29KyDwk9MjYmMyOXxQIIKuShqo4VGFNBEgeDQYqVam5N5tEePFQgURIUBCsd1EWd1XrtDUUMLARD9bKaK5ytQ2Gb75g8WMiEP6VkfnZGevv6UF1vSBW5E0PFDAweFRvlfun8WVmamhDNrkmweQ0pwaPt6M4m8mgKTTFXqcrV0ZH1FKBg6qAu6qTuJiCV1Cp2Q0NDr9Uq5Ym+oMEDlSewsoRwrVBEaij7AJ4s7zrOpumxEdm15y6558GHJVe1Zezy6zJx6aJkpq5JFB4z6zVZmBiX1VWUP0IY4CFMYcpQdZ3xqIs6oftCE5DHKwd0q/tzOV8svdDb3nk8VnG9qmgQC0ZURz8Ur91alXgSByZ6ES9kZZTr/PR16UOCh+7dq0CWyyXJ4xqCQ0nKt9YQSlPue2gAeYZzD7yNLk0wmqAreb2WYSxAJ8Dget64wxtEBlDaqVOn/K5dB67t6+t5MhoMJuc8w8UPKiQ9CQR9JK5czhZAQxPt7TKF3OiAIisUViAD2Lg5d0P2HDgoKeRaW0enyqVwBJcO5fFG5dqa7h406qaeX8384uTZL5w9+UqxhYHFp0YLIYA9ddfu3T+4UJF6Rg+YAc9D0+RoIGP1ULhpWspr10evyK7+ftWTrk9PS/++A9KZSm26cih2mMOErem6n/ZsZwA2TM/MPHXs2LEftnSTbh0Q36mIIbx44cLvOnu3f+xUwbWLmoHTCUlF6g2jBQo/GnFrnGNqSHdvr+rIKGMW1KahwEBdzHft98aNwMr8zd8/NDDwccihc0hLi3GubRjY0Bm6H19fPvnZI4c/fHd7PJ2peXYZ+WQ26JufZELjQ6lbAQtnWre0d3apY8TFIdtAo+Qri6mupsB49lBMC+QXF0YefObZT8j0eKWlswVjEyCCOXHihPGb575VCvVuf3lvetsH9rXF0rla3cnhpoIGjgsUPhR3I4TMKYJQV1Z6WO02aEjHa5mNe3OPW3OPRHVrbXFh9Ocvv/KR1372owx1Pf3005uc35Ddgtd8rsf06IdS5777zZ+mUqmPzjm6TPpmvayZOq4LyATeCzkanmiy4qEuC/yXiO8CSMRzvLs1x9phepLNZl868sy3Pyen/5hd1/EfRvWmuvSWNeaRS/RkPDI4+NjE1NSXEoXlpaNB1zqo20abi59/vu/UfM2pie7WUDVq8l3wTwnskeZ+zTbIQ17KoCzKpGzq2KqX32/roRbh8ePHdUzl0s9/5Rv9n/7go19MxCKfCkZiu3V06wrO5gocxL7Dgd/IEobEMH6rejg+auXidL5Y/vWv/vTX53/y/e/MkGajTH7fOt4RUJOY1df4RdtY6ICFRzqTySOhUOA+3Ai3o31H1ZbnlXBruFmt2iMrudy5xx9//BzWV7nXDBGN2xpjbt/5oGUEdhtO3iD47xZOvm8a5CHvpsV38wsUaMwBWsz3rbK5xr0mzdv2t9Jv/f5vhsF4J+Q63IUAAAAASUVORK5CYII='
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
