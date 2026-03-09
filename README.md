# myGPT (Vite + React + Electron + OpenAI)

A desktop AI assistant application built with Electron, React, Vite, and the OpenAI API.

## Prerequisites

1. **Node.js**: Make sure you have Node.js installed (v18+ recommended).
2. **Yarn** or **NPM**: Yarn is primarily used in this project.
3. **OpenAI API Key**: You will need an API key from OpenAI and an Assistant/Thread configuration.

## Environment Variables

Before starting the app, ensure you have a `.env` file in the root of the project setup with the following variables. (An example of the `.env` provided):

```env
PORT=3000
VITE_API_KEY=sk-proj-...
VITE_THREAD_ID=thread_...
VITE_ASSISTANT_ID=asst_...
```

## How to Start the App

Follow these steps to run the application in a development environment:

### 1. Install Dependencies

Open a terminal in the project directory and run:

```bash
yarn install
```

_(or `npm install`)_

### 2. Start the Vite React Server

In the same terminal, start the React frontend:

```bash
yarn dev
```

_(or `npm run dev`)_

### 3. Start the Electron App

**Open a second terminal window** in the project directory and run:

```bash
yarn dev:electron
```

_(or `npm run dev:electron`)_

The Electron desktop application will launch and load the React interface!

## Building for Production

To create an executable for your operating system:

```bash
# Build for Mac
yarn dist:mac

# Build for Windows
yarn dist:win

# Build for Linux
yarn dist:linux
```
