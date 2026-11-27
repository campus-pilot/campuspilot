import { useRef, useState } from "react";
import { Play } from "lucide-react";

import { demoLanguages, demoPosterSrc, demoVideoSrc, formatDuration, type Demo, type DemoLanguage } from "./demos";

/** cover → language choice → playing. The video element only exists while playing. */
type Phase = "cover" | "choose" | "playing";

type DemoPlayerProps = {
  demo: Demo;
  /**
   * The language the chooser highlights and focuses (English when omitted).
   * The home list passes the language the visitor last chose. It never skips
   * the cover: a video is only fetched after the visitor presses play.
   */
  preferredLanguage?: DemoLanguage;
  onLanguageChange?: (language: DemoLanguage) => void;
  /** Load the cover image eagerly (above the fold, as in a page hero). */
  eager?: boolean;
};

/**
 * Playback state for one demo. Switching narration swaps the video source, so
 * the position to resume from is captured in the click handler and applied
 * when the new cut's metadata loads. The English and Hindi cuts differ in
 * length (the narration does), so the position is carried as a fraction of
 * the cut rather than in seconds.
 */
function useDemoPlayback({ preferredLanguage, onLanguageChange }: Pick<DemoPlayerProps, "preferredLanguage" | "onLanguageChange">) {
  const [phase, setPhase] = useState<Phase>("cover");
  const [language, setLanguage] = useState<DemoLanguage>(preferredLanguage ?? "en");
  const videoRef = useRef<HTMLVideoElement>(null);
  const resume = useRef({ fraction: 0, play: true });

  function selectLanguage(next: DemoLanguage) {
    setLanguage(next);
    onLanguageChange?.(next);
  }

  function start(next: DemoLanguage) {
    resume.current = { fraction: 0, play: true };
    selectLanguage(next);
    setPhase("playing");
  }

  function switchLanguage(next: DemoLanguage) {
    const video = videoRef.current;
    if (next === language || !video) return;
    const midway = Number.isFinite(video.duration) && !video.ended;
    resume.current = { fraction: midway ? video.currentTime / video.duration : 0, play: !video.paused || video.ended };
    selectLanguage(next);
  }

  /** Autoplay can still be refused (no recent tap on iOS); the native controls stay available then. */
  function handleLoadedMetadata(event: React.SyntheticEvent<HTMLVideoElement>) {
    const video = event.currentTarget;
    const { fraction, play } = resume.current;
    if (fraction > 0) video.currentTime = fraction * video.duration;
    if (play) video.play().catch(() => undefined);
  }

  return {
    phase,
    language,
    videoRef,
    choose: () => setPhase("choose"),
    cancel: () => setPhase("cover"),
    start,
    switchLanguage,
    handleLoadedMetadata,
  };
}

function DemoCover({ demo, onPlay }: { demo: Demo; onPlay: () => void }) {
  return (
    <button type="button" className="cp-demo-cover" onClick={onPlay} aria-label={`Play the ${demo.title} demo`}>
      <span className="cp-demo-play" aria-hidden="true">
        <Play />
      </span>
      <span className="cp-demo-meta" aria-hidden="true">
        <b>Watch the demo</b>
        <small>{formatDuration(demo.durations.en)} · English or हिंदी</small>
      </span>
    </button>
  );
}

/** Shown after the play button; the preferred language is primary and focused, so Enter plays it. */
function LanguageChooser({
  preferred,
  onChoose,
  onCancel,
}: {
  preferred: DemoLanguage;
  onChoose: (language: DemoLanguage) => void;
  onCancel: () => void;
}) {
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") onCancel();
  }

  function handleBackdropClick(event: React.MouseEvent) {
    if (event.target === event.currentTarget) onCancel();
  }

  return (
    <div className="cp-demo-choose" role="group" aria-label="Choose the narration language" onKeyDown={handleKeyDown} onClick={handleBackdropClick}>
      <p>Play with narration in</p>
      <div className="cp-demo-langs">
        {demoLanguages.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`cp-btn ${option.id === preferred ? "cp-btn-primary" : "cp-btn-light"}`}
            lang={option.id}
            aria-label={`Play in ${option.name}`}
            autoFocus={option.id === preferred}
            onClick={() => onChoose(option.id)}
          >
            <Play aria-hidden="true" /> {option.label}
          </button>
        ))}
      </div>
      <button type="button" className="cp-demo-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function LanguageSwitch({ value, onChange }: { value: DemoLanguage; onChange: (language: DemoLanguage) => void }) {
  return (
    <div className="cp-demo-switch" role="group" aria-label="Narration language">
      {demoLanguages.map((option) => (
        <button key={option.id} type="button" lang={option.id} aria-label={option.name} aria-pressed={option.id === value} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * A narrated product demo: the cover with a play button, then a choice of
 * English or Hindi narration, then the video with native controls and a
 * language switch that keeps the place in the recording.
 */
export function DemoPlayer({ demo, preferredLanguage, onLanguageChange, eager = false }: DemoPlayerProps) {
  const playback = useDemoPlayback({ preferredLanguage, onLanguageChange });
  const language = demoLanguages.find((option) => option.id === playback.language);

  if (playback.phase === "playing") {
    return (
      <div className="cp-demo" data-phase="playing">
        <video
          ref={playback.videoRef}
          src={demoVideoSrc(demo, playback.language)}
          poster={demoPosterSrc(demo)}
          aria-label={`${demo.title} demo, ${language?.name} narration`}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={playback.handleLoadedMetadata}
        />
        <LanguageSwitch value={playback.language} onChange={playback.switchLanguage} />
      </div>
    );
  }

  return (
    <div className="cp-demo" data-phase={playback.phase}>
      <img src={demoPosterSrc(demo)} alt="" width={1280} height={720} loading={eager ? "eager" : "lazy"} decoding="async" />
      {playback.phase === "cover" ? <DemoCover demo={demo} onPlay={playback.choose} /> : null}
      {playback.phase === "choose" ? <LanguageChooser preferred={playback.language} onChoose={playback.start} onCancel={playback.cancel} /> : null}
    </div>
  );
}
