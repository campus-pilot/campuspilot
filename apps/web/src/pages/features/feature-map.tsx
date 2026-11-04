import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { featureData, featureDirectory, type DirectoryEntry, type FeatureSlug } from "@/site/content/catalog";
import { featureArt } from "@/site/signature";
import { Section, SectionIntro } from "@/site/ui/section";

import { SecurityPreview } from "./security-preview";

type PreviewKey = FeatureSlug | "security";

/**
 * Which preview each directory link shows. Modelled explicitly per href rather
 * than parsed from the URL, so a renamed route can never pick the wrong art.
 */
const PREVIEW_BY_HREF: Readonly<Record<string, PreviewKey | undefined>> = {
  "/features/admissions": "admissions",
  "/features/academics": "academics",
  "/features/billing": "billing",
  "/features/examinations": "examinations",
  "/features/documents": "documents",
  "/features/dashboards": "dashboards",
  "/features/student-portal": "student-portal",
  "/security": "security",
};

type MapEntry = DirectoryEntry & { key: PreviewKey };

const mapEntries: readonly MapEntry[] = featureDirectory.flatMap((entry) => {
  const key = PREVIEW_BY_HREF[entry.href];
  return key ? [{ ...entry, key }] : [];
});

const securitySteps = ["School boundary", "Role permissions", "Teacher scopes", "Student access"] as const;

function stepsFor(key: PreviewKey): readonly string[] {
  return key === "security" ? securitySteps : featureData[key].steps;
}

function PreviewArt({ previewKey }: { previewKey: PreviewKey }) {
  if (previewKey === "security") return <SecurityPreview />;
  const Art = featureArt[previewKey];
  return <Art />;
}

/** Index of the entry whose art is shown. Only hover and focus change it; clicks just navigate. */
function useActivePreview() {
  const [activeIndex, setActiveIndex] = useState(0);
  return { active: mapEntries[activeIndex] ?? mapEntries[0], activeIndex, setActiveIndex };
}

type MapLinkProps = {
  entry: MapEntry;
  index: number;
  isActive: boolean;
  onActivate: () => void;
};

function MapLink({ entry, index, isActive, onActivate }: MapLinkProps) {
  const Icon = entry.icon;
  return (
    <li>
      <Link
        to={entry.href}
        className="pg-features-map-link"
        data-active={isActive || undefined}
        onMouseEnter={onActivate}
        onFocus={onActivate}
      >
        <span className="pg-features-map-num">{String(index + 1).padStart(2, "0")}</span>
        <span className="pg-features-map-icon"><Icon aria-hidden="true" /></span>
        <span className="pg-features-map-text">
          <b>{entry.title}</b>
          <small>{entry.text}</small>
        </span>
        <ArrowRight className="pg-features-map-go" aria-hidden="true" />
      </Link>
    </li>
  );
}

function PreviewCaption({ entry, index }: { entry: MapEntry; index: number }) {
  return (
    <div className="pg-features-map-caption">
      <p>
        <span>{String(index + 1).padStart(2, "0")}</span> {entry.title}
      </p>
      <ol>
        {stepsFor(entry.key).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Sticky preview beside the list (desktop only). Keyed by entry so the art
 * remounts and replays its entrance on every change. Decorative: the link
 * list already says everything the preview shows.
 */
function MapPreview({ entry, index }: { entry: MapEntry; index: number }) {
  return (
    <div className="pg-features-map-preview" aria-hidden="true">
      <div className="pg-features-map-stage" key={entry.key}>
        <PreviewArt previewKey={entry.key} />
      </div>
      <PreviewCaption entry={entry} index={index} />
    </div>
  );
}

/**
 * The features directory as a map: a numbered list of links on the left and a
 * live preview of the hovered or focused feature on the right. Plain links all
 * the way down, so Tab and Enter work and phones get a simple list.
 */
function FeatureMap() {
  const { active, activeIndex, setActiveIndex } = useActivePreview();
  return (
    <div className="pg-features-map">
      <ol className="pg-features-map-list">
        {mapEntries.map((entry, index) => (
          <MapLink
            key={entry.href}
            entry={entry}
            index={index}
            isActive={index === activeIndex}
            onActivate={() => setActiveIndex(index)}
          />
        ))}
      </ol>
      <MapPreview entry={active} index={activeIndex} />
    </div>
  );
}

export function FeatureMapSection() {
  return (
    <Section id="feature-map" labelledBy="pg-features-map-title" className="pg-features-map-section">
      <SectionIntro
        id="pg-features-map-title"
        eyebrow="Feature map"
        title="Pick a workflow. Keep the context."
        description="Each feature works deeply on its own and naturally with the rest. Hover or tab through the list to preview one, then open it for the detail."
      />
      <FeatureMap />
    </Section>
  );
}
