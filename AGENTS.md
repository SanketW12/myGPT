# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

myGPT is an Electron + React + Vite desktop AI chat assistant. See `README.md` and `package.json` for standard commands (`yarn dev`, `npm run build`, `npm run lint`, etc.).

### Running the dev server

- `npm run dev` starts Vite on port 5421 **and** launches Electron via `vite-plugin-electron`. Both services start from a single command.
- On headless Linux (Cloud Agent VMs), Electron needs `DISPLAY=:1` (Xvfb is pre-configured). Launch with: `DISPLAY=:1 npm run dev`.
- D-Bus errors (`Failed to connect to the bus`) are expected on headless VMs and do not affect functionality.

### Environment variables

A `.env` file in the project root is required. The only critical variable is:

- `VITE_API_KEY` — OpenAI API key. Without a valid key the app UI loads normally but AI chat/transcription features return errors.
- `VITE_ASSISTANT_ID`, `VITE_THREAD_ID` — optional, for the OpenAI Assistants API mode.

### Linting

- `npm run lint` runs ESLint. The repo has pre-existing lint errors (mostly Prettier formatting); these are not regressions.
- `npm run lint:fix` auto-fixes most Prettier issues.

### Building

- `npm run build` runs both `build:vite` (Vite production build) and `build:electron` (TypeScript compilation for Electron main process).
- The Vite build emits a chunk size warning — this is expected.

### No automated tests

This repository has no test framework or test suite. Verify changes via lint, build, and manual testing of the Electron app.
