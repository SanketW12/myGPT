import { useState, useCallback } from 'react';
import { createWorker } from 'tesseract.js';

interface UseScreenshotProps {
  onOCRComplete?: (text: string) => void;
  onImageCaptured?: (dataUrl: string) => void;
}

export const useScreenshot = ({ onOCRComplete, onImageCaptured }: UseScreenshotProps = {}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [isAreaCaptureMode, setIsAreaCaptureMode] = useState(false);

  const performOCR = useCallback(async (imageDataUrl: string) => {
    console.log('🔍 Performing OCR...');
    setIsProcessing(true);

    try {
      const worker = await createWorker('eng');
      const ret = await worker.recognize(imageDataUrl);
      console.log('OCR Text:', ret.data.text);

      await worker.terminate();

      if (ret.data.text && ret.data.text.trim()) {
        const text = `Screenshot Text:\n${ret.data.text}`;
        if (onOCRComplete) onOCRComplete(text);
      } else {
        console.log('⚠️ No text found in screenshot');
      }
    } catch (error) {
      console.error('OCR Error:', error);
    } finally {
      setIsProcessing(false);
    }
  }, [onOCRComplete]);

  const takeFullScreenScreenshot = useCallback(async () => {
    console.log('📸 Taking screenshot...');
    if (isProcessing) return;

    setIsProcessing(true);

    try {
      // Get sources
      const sources = await window.Main.getDesktopSources();
      const screenSource = sources.find((s: any) => s.name.includes('Screen') || s.name.includes('Entire Screen')) || sources[0];

      if (!screenSource) {
        console.error('No screen source found');
        setIsProcessing(false);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: screenSource.id,
            minWidth: 1280,
            maxWidth: 4000,
            minHeight: 720,
            maxHeight: 4000
          }
        } as any
      });

      const video = document.createElement('video');
      video.srcObject = stream;
      video.onloadedmetadata = async () => {
        video.play();

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          stream.getTracks().forEach(track => track.stop());

          const imageDataUrl = canvas.toDataURL('image/png');
          console.log('✅ Full screen screenshot captured successfully!');

          // Default behavior: Perform OCR
          await performOCR(imageDataUrl);
        } else {
          setIsProcessing(false);
        }
      };
    } catch (error) {
      console.error('Error taking screenshot:', error);
      setIsProcessing(false);
    }
  }, [isProcessing, performOCR]);

  const captureForDownload = useCallback(async () => {
    console.log('⬇️ Taking screenshot for download...');
    try {
      const sources = await window.Main.getDesktopSources({
        fetchThumbnail: true,
        thumbnailSize: { width: 1920, height: 1080 }
      });

      const screenSource = sources.find((s: any) => s.name.includes('Screen') || s.name.includes('Entire Screen')) || sources[0];

      if (screenSource && screenSource.thumbnail) {
        setScreenshotDataUrl(screenSource.thumbnail);
        setShowModal(true);
      }
    } catch (error) {
      console.error('❌ Error taking screenshot:', error);
    }
  }, []);

  const closeScreenshotModal = useCallback(() => {
    setShowModal(false);
    setScreenshotDataUrl(null);
  }, []);

  const downloadScreenshot = useCallback(() => {
    if (screenshotDataUrl) {
      const link = document.createElement('a');
      link.href = screenshotDataUrl;
      link.download = `screenshot-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      console.log('✅ Screenshot download initiated');
    }
  }, [screenshotDataUrl]);

  // For Area Screenshot component interaction
  const handleAreaCapture = useCallback((dataUrl: string) => {
    setIsAreaCaptureMode(false);
    if (onImageCaptured) {
      onImageCaptured(dataUrl);
    }
  }, [onImageCaptured]);

  return {
    isProcessing,
    isAreaCaptureMode,
    setIsAreaCaptureMode,
    showModal,
    screenshotDataUrl,
    takeFullScreenScreenshot,
    captureForDownload,
    downloadScreenshot,
    closeScreenshotModal,
    handleAreaCapture
  };
};
