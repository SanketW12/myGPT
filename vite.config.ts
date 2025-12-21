import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react';
import { UserConfig, ConfigEnv } from 'vite';
import { rmSync } from 'node:fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import electron from 'vite-plugin-electron';
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
    external: [
      'electron',
      ...Object.keys(pkg.dependencies || {})
    ]
  }
});

function plugins(isDev: boolean) {
  return [
    react(),
    tailwindcss(),
    electron([
      {
        // Preload-Process
        entry: join(root, 'electron/preload.ts'),
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            ...buildElectron(isDev),
            lib: false, // Disable lib mode for preload to avoid ESM wrapping
            rollupOptions: {
              ...buildElectron(isDev).rollupOptions,
              input: join(root, 'electron/preload.ts'),
              output: {
                format: 'cjs',
                entryFileNames: 'preload.cjs',
                inlineDynamicImports: true,
                exports: 'none' // No exports for preload script
              }
            }
          }
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
