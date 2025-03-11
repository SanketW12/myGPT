/* eslint-disable operator-assignment */
import React, { useEffect, useState } from 'react';
import MarkdownPreview from '@uiw/react-markdown-preview';
// Define the props for the TypingEffect component
interface TypingEffectProps {
  text: string;
  speed?: number; // Optional speed prop to control typing speed
}

function TypingEffect({ text, speed = 20 }: TypingEffectProps) {
  const [displayedText, setDisplayedText] = useState<string>('');

  useEffect(() => {
    let index = 0;
    const interval = setInterval(() => {
      setDisplayedText((prev) => prev + text[index]);
      index = index + 1;

      if (index === text.length) {
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval); // Cleanup interval on unmount
  }, [text, speed]);

  return (
    <span className="relative inline-block !cursor-default">
      {' '}
      <MarkdownPreview className="!bg-transparent !text-white" source={displayedText} />
    </span>
  );
}

export default TypingEffect;
