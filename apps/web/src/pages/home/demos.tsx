import { useRef, useState } from "react";
import { ArrowRight, CirclePlay } from "lucide-react";
import { Link } from "react-router";

import { DemoPlayer } from "@/site/demo/demo-player";
import { demos, formatDuration, type Demo, type DemoLanguage } from "@/site/demo/demos";
import { Section, SectionIntro } from "@/site/ui/section";

/**
 * Which demo is on the stage, and the narration language the visitor picked
 * (none until they press play once). Picking another demo shows its cover
 * again rather than playing it, so a video is only fetched when the visitor
 * presses play; the language they picked becomes the chooser's default. It
 * also brings the stage into view on narrow screens where the list sits below it.
 */
function useDemoSelection() {
  const [selectedId, setSelectedId] = useState(demos[0].id);
  const [language, setLanguage] = useState<DemoLanguage | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const selected = demos.find((demo) => demo.id === selectedId) ?? demos[0];

  function select(id: string) {
    setSelectedId(id);
    stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  return { selected, language, setLanguage, select, stageRef };
}

function DemoCaption({ demo }: { demo: Demo }) {
  return (
    <div className="pg-home-demo-caption">
      <h3>{demo.title}</h3>
      <p>{demo.summary}</p>
      <Link to={demo.href}>
        {demo.hrefLabel} <ArrowRight aria-hidden="true" />
      </Link>
    </div>
  );
}

function DemoListItem({ demo, selected, onSelect }: { demo: Demo; selected: boolean; onSelect: () => void }) {
  const Icon = demo.icon;
  return (
    <li>
      <button type="button" className="pg-home-demo-item" aria-pressed={selected} onClick={onSelect}>
        <span className="cp-menu-tile" aria-hidden="true">
          <Icon />
        </span>
        <span className="pg-home-demo-text">
          <b>{demo.title}</b>
          <small>{formatDuration(demo.durations.en)}</small>
        </span>
      </button>
    </li>
  );
}

function DemoList({ selectedId, onSelect }: { selectedId: string; onSelect: (id: string) => void }) {
  return (
    <ol className="pg-home-demo-list" aria-label="Demos">
      {demos.map((demo) => (
        <DemoListItem key={demo.id} demo={demo} selected={demo.id === selectedId} onSelect={() => onSelect(demo.id)} />
      ))}
    </ol>
  );
}

/** Home `#demos`, directly under the hero: one player on the stage, every recorded demo beside it. */
export function DemosSection() {
  const selection = useDemoSelection();
  return (
    <Section id="demos" labelledBy="pg-home-demos-title">
      <SectionIntro
        id="pg-home-demos-title"
        eyebrow="Product demos"
        eyebrowIcon={CirclePlay}
        title="Watch CampusPilot do the work."
        description="Short recordings of the real app on a sample school. Pick a feature, press play, and choose English or Hindi narration."
      />
      <div className="pg-home-demos">
        <div className="pg-home-demo-stage" ref={selection.stageRef}>
          <DemoPlayer
            key={selection.selected.id}
            demo={selection.selected}
            preferredLanguage={selection.language ?? undefined}
            onLanguageChange={selection.setLanguage}
          />
          <DemoCaption demo={selection.selected} />
        </div>
        <DemoList selectedId={selection.selected.id} onSelect={selection.select} />
      </div>
    </Section>
  );
}
