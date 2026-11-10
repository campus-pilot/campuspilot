'use client';

import { useCallback, useRef, useState } from 'react';
import { Button } from '@campuspilot/ui/components/button';
import { Camera, LoaderCircle } from 'lucide-react';

const CAPTURE_MIME_TYPE = 'image/jpeg';
const CAPTURE_QUALITY = 0.92;

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function cameraErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Camera access was blocked. Allow it in the browser to take a photo.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No camera was found on this device.';
  }
  return 'Unable to start the camera.';
}

/** Encodes the frame currently shown by the video as a JPEG file. */
function captureFrame(video: HTMLVideoElement, fileName: string) {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0 || canvas.height === 0) {
    return Promise.reject(new Error('The camera is not ready yet. Try again.'));
  }
  context.drawImage(video, 0, 0);
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], fileName, { type: CAPTURE_MIME_TYPE, lastModified: Date.now() }))
          : reject(new Error('Unable to capture the photo.')),
      CAPTURE_MIME_TYPE,
      CAPTURE_QUALITY,
    );
  });
}

/**
 * Owns one camera stream. The stream is released by the `<video>` ref's
 * cleanup, so it stops whenever the preview leaves the page (capture, cancel
 * or the surrounding dialog closing) without an effect. A permission prompt
 * answered after the component has gone is released straight away.
 */
function useCameraCapture(onCapture: (file: File) => void, fileName: string) {
  const [stream, setStream] = useState<MediaStream>();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isDisposedRef = useRef(false);

  /** Marks the component as gone so a late camera grant is not kept open. */
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    isDisposedRef.current = false;
    return () => {
      isDisposedRef.current = true;
    };
  }, []);

  const previewRef = useCallback(
    (video: HTMLVideoElement | null) => {
      if (!video || !stream) return;
      videoRef.current = video;
      video.srcObject = stream;
      return () => {
        videoRef.current = null;
        stopStream(stream);
      };
    },
    [stream],
  );

  async function start() {
    setError(undefined);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot use the camera here.');
      return;
    }
    setIsStarting(true);
    try {
      // Prefer a phone's rear camera; a laptop falls back to its only camera.
      const nextStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (isDisposedRef.current) stopStream(nextStream);
      else setStream(nextStream);
    } catch (cameraError) {
      setError(cameraErrorMessage(cameraError));
    } finally {
      setIsStarting(false);
    }
  }

  async function capture() {
    if (!videoRef.current) return;
    try {
      onCapture(await captureFrame(videoRef.current, fileName));
      setStream(undefined);
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Unable to capture the photo.');
    }
  }

  return { stream, isStarting, error, rootRef, previewRef, start, capture, cancel: () => setStream(undefined) };
}

/**
 * Takes a photo with the device camera as an alternative to choosing a file.
 * A file input cannot open a desktop webcam, so this shows a live preview
 * and hands the captured frame to `onCapture` as a JPEG file.
 */
export function CameraCapture({
  onCapture,
  disabled = false,
  fileName = 'camera-photo.jpg',
}: {
  onCapture: (file: File) => void;
  disabled?: boolean;
  fileName?: string;
}) {
  const camera = useCameraCapture(onCapture, fileName);
  return (
    <div ref={camera.rootRef} className="flex flex-col gap-2">
      {camera.stream ? (
        <>
          <video
            ref={camera.previewRef}
            className="aspect-video w-full rounded-lg bg-black object-contain"
            aria-label="Camera preview"
            autoPlay
            muted
            playsInline
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={camera.cancel}>
              Close camera
            </Button>
            <Button type="button" disabled={disabled} onClick={() => void camera.capture()}>
              <Camera aria-hidden /> Capture
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="outline" disabled={disabled || camera.isStarting} onClick={() => void camera.start()}>
          {camera.isStarting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
          Take a photo
        </Button>
      )}
      {camera.error ? <p className="text-xs text-destructive">{camera.error}</p> : null}
    </div>
  );
}
