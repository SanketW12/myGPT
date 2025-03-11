/* eslint-disable prefer-template */
import React, { useEffect, useState } from 'react';

export default function TypeLoading() {
  const [dots, setDots] = useState<string>('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length < 3 ? prev + '.' : ''));
    }, 500);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex !items-center  ">
      <span className="-mt-4 min-h-[40px] text-4xl  animate-pulse ">{dots}</span>
    </div>
  );
}
