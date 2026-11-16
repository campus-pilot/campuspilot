import { Button } from '@campuspilot/ui/components/button';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, useCarousel } from '@campuspilot/ui/components/carousel';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@campuspilot/ui/components/dialog';
import { Spinner } from '@campuspilot/ui/components/spinner';
import { cn } from '@campuspilot/ui/lib/utils';
import { Download, X } from 'lucide-react';
import { useCallback, useState, useSyncExternalStore } from 'react';

import type { ViewerImage } from './assistant-attachments-model';

/**
 * How far from the image in view an original is loaded. Originals are full
 * size (up to 15 MB), so a message of twenty photos fetches the open one and
 * its neighbours, not all twenty.
 */
const PRELOAD_DISTANCE = 1;

/** Light controls over the dark backdrop, the same in light and dark themes. */
const ON_BACKDROP = 'text-white hover:bg-white/10 hover:text-white';

/**
 * The index of the image in view. Read from embla through
 * `useSyncExternalStore` rather than an effect: it re-reads on every
 * `select`, and is the image the viewer opened on until embla is ready.
 */
function useSelectedIndex(openedOn: number) {
  const { api } = useCarousel();
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!api) return () => {};
      api.on('select', onChange);
      api.on('reInit', onChange);
      return () => {
        api.off('select', onChange);
        api.off('reInit', onChange);
      };
    },
    [api],
  );
  return useSyncExternalStore(subscribe, () => api?.selectedScrollSnap() ?? openedOn, () => openedOn);
}

/** The bar over the viewer: the image's name and place, a download of the original, and close. */
function ViewerToolbar({ images, openedOn }: { images: readonly ViewerImage[]; openedOn: number }) {
  const index = useSelectedIndex(openedOn);
  const image = images[index] ?? images[0]!;
  return (
    <div className="flex items-center gap-2 px-3 py-2 text-white">
      <DialogTitle className="min-w-0 flex-1 truncate text-white">{image.fileName}</DialogTitle>
      {images.length > 1 ? (
        <span className="shrink-0 text-xs tabular-nums text-white/70">
          {index + 1} of {images.length}
        </span>
      ) : null}
      <Button asChild variant="ghost" size="icon-sm" className={ON_BACKDROP}>
        {/* The route answers with `Content-Disposition: attachment`, so following it saves the file. */}
        <a href={image.originalUrl} download={image.fileName} aria-label={`Download ${image.fileName}`}>
          <Download />
        </a>
      </Button>
      <DialogClose asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Close" className={ON_BACKDROP}>
          <X />
        </Button>
      </DialogClose>
    </div>
  );
}

/**
 * One image at full size, never enlarged past its own pixels. The thumbnail
 * stands in (scaled up, softened) with a spinner until the original loads;
 * if the original cannot be shown (a format this browser cannot draw), the
 * thumbnail stays and the download is the way to see it.
 */
function ViewerSlide({ image, near }: { image: ViewerImage; near: boolean }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  // Once loaded it stays, so moving back and forth never flickers.
  const showOriginal = near || state === 'loaded';
  return (
    <CarouselItem className="relative flex h-full items-center justify-center pb-4 sm:px-16">
      {state !== 'loaded' && image.previewUrl ? (
        <img
          src={image.previewUrl}
          alt=""
          draggable={false}
          className={cn('select-none object-contain', state === 'failed' ? 'max-h-full max-w-full' : 'size-full blur-sm')}
        />
      ) : null}
      {showOriginal ? (
        <img
          src={image.originalUrl}
          alt={image.fileName}
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn('max-h-full max-w-full select-none object-contain', state !== 'loaded' && 'absolute opacity-0')}
        />
      ) : null}
      {showOriginal && state === 'loading' ? <Spinner className="absolute size-6 text-white" /> : null}
      {state === 'failed' ? (
        <p className="absolute inset-x-0 bottom-6 text-center text-xs text-white/80">This image cannot be shown at full size here. Download it to view it.</p>
      ) : null}
    </CarouselItem>
  );
}

function ViewerSlides({ images, openedOn }: { images: readonly ViewerImage[]; openedOn: number }) {
  const index = useSelectedIndex(openedOn);
  return (
    <CarouselContent className="h-full">
      {images.map((image, position) => (
        <ViewerSlide key={image.id} image={image} near={Math.abs(position - index) <= PRELOAD_DISTANCE} />
      ))}
    </CarouselContent>
  );
}

/** Previous and next, on wider screens; a phone swipes. */
function ViewerArrows() {
  const arrow = cn('hidden border-white/20 bg-black/40 sm:inline-flex hover:bg-black/60 disabled:opacity-30', ON_BACKDROP);
  return (
    <>
      <CarouselPrevious variant="outline" size="icon" className={cn('left-3', arrow)} />
      <CarouselNext variant="outline" size="icon" className={cn('right-3', arrow)} />
    </>
  );
}

/**
 * A full-screen viewer for the images of one message, opened on the one
 * clicked. Each shows the original, not the thumbnail; the arrows, the arrow
 * keys or a swipe move between them, and Escape or the close button shuts
 * it. The toolbar sits inside the carousel so the arrow keys work wherever
 * focus is in the viewer. The carousel mounts each time the dialog opens, so
 * `openedOn` is read once, as embla's start index.
 */
export function AssistantImageViewer({
  images,
  openedOn,
  open,
  onOpenChange,
}: {
  images: readonly ViewerImage[];
  /** The position in `images` of the image that was clicked. */
  openedOn: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (images.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="inset-0 top-0 left-0 block h-dvh w-screen max-w-none translate-x-0 translate-y-0 rounded-none bg-black/70 p-0 ring-0 sm:max-w-none data-open:zoom-in-100 data-closed:zoom-out-100"
      >
        <Carousel
          opts={{ startIndex: openedOn }}
          className="flex h-full flex-col *:data-[slot=carousel-content]:min-h-0 *:data-[slot=carousel-content]:flex-1"
        >
          <ViewerToolbar images={images} openedOn={openedOn} />
          <ViewerSlides images={images} openedOn={openedOn} />
          {images.length > 1 ? <ViewerArrows /> : null}
        </Carousel>
      </DialogContent>
    </Dialog>
  );
}
