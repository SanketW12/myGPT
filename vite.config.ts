import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react';
import { UserConfig, ConfigEnv } from 'vite';
import { rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import pkg from './package.json';


const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname);
const srcRoot = join(__dirname, 'src');
rmSync('dist-electron', { recursive: true, force: true });

const buildElectron = (isDev: boolean) => ({
  sourcemap: isDev,
  minify: !isDev,
  outDir: join(root, 'dist-electron'),
  rollupOptions: {
    external: Object.keys(pkg.dependencies || {})
  }
});

function plugins(isDev: boolean) {
  return [
    react(),
    tailwindcss(),
    electron([
      {
        // Main-Process entry file of the Electron App.
        entry: join(root, 'electron/preload.ts'),
        onstart(options) {
          // Notify the Renderer-Process to reload the page when the Preload-Scripts build is complete,
          // instead of restarting the entire Electron App.
          options.reload();
        },
        vite: {
          build: {
            ...buildElectron(isDev),
            rollupOptions: {
              ...buildElectron(isDev).rollupOptions,
              output: {
                format: 'cjs' as const, // MUST be CommonJS
                entryFileNames: '[name].cjs' // Use .cjs extension
              }
            }
          },
          plugins: [
            {
              name: 'fix-preload-cjs',
              closeBundle() {
                const preloadPath = join(root, 'dist-electron/preload.cjs');
                try {
                  if (existsSync(preloadPath)) {
                    let content = readFileSync(preloadPath, 'utf8');
                    if (content.includes('export default')) {
                      content = content.replace(/^export default .+;$/m, '');
                      writeFileSync(preloadPath, content);
                      console.log('✅ Fixed preload.cjs (removed export default)');
                    }
                  }
                } catch (e) {
                  console.warn('⚠️ Could not fix preload.cjs:', e);
                }
              }
            }
          ]
        }
      },
      {
        entry: join(root, 'electron/index.ts'),
        onstart(options) {
          options.startup();
        },
        vite: {
          build: buildElectron(isDev)
        }
      }
    ])

    // Removed renderer() plugin - it interferes with contextBridge in preload
    // renderer()
  ];
}

export default ({ command }: ConfigEnv): UserConfig => {
  // DEV
  if (command === 'serve') {
    return {
      root: srcRoot,
      envDir: root, // Load .env files from project root
      base: '/',
      plugins: plugins(true),
      resolve: {
        alias: {
          '/@': srcRoot
        }
      },
      build: {
        outDir: join(root, '/dist-vite'),
        emptyOutDir: true,
        rollupOptions: {}
      },
      server: {
        port: process.env.PORT === undefined ? 5421 : +process.env.PORT
      },
      optimizeDeps: {
        exclude: ['path']
      }
    };
  }
  // PROD
  return {
    root: srcRoot,
    envDir: root, // Load .env files from project root
    base: './',
    plugins: plugins(false),
    resolve: {
      alias: {
        '/@': srcRoot
      }
    },
    build: {
      outDir: join(root, '/dist-vite'),
      emptyOutDir: true,
      rollupOptions: {}
    },
    server: {
      port: process.env.PORT === undefined ? 3000 : +process.env.PORT
    },
    optimizeDeps: {
      exclude: ['path']
    }
  };
};
