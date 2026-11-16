import React, { useEffect } from 'react';

import ChatUI from './components/ChatUI';

function App() {
  useEffect(() => {
    window?.Main?.removeLoading();
  }, []);

  return (
    <div className="flex flex-col">
      <ChatUI />
    </div>
  );
}

export default App;
