import React, { useEffect } from 'react';

import ChatUI from './components/ChatUI';

function App() {
  useEffect(() => {
    window?.Main?.removeLoading();
  }, []);

  const handleMove = (direction: string) => {
    window?.Main?.handleDirection(direction);
  };

  // Handle arrow key presses
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        const direction = event.key.replace('Arrow', '').toLowerCase();
        handleMove(direction);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="  flex flex-col">
      <ChatUI />
    </div>
  );
}

export default App;
