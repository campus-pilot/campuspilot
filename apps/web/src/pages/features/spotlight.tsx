import { Check, Focus } from "lucide-react";

import type { DetailData, FeatureSlug } from "@/site/content/catalog";
import { Pill } from "@/site/ui/section";

import { spotlightArt } from "./spotlight-art";

function SpotlightCopy({ data }: { data: DetailData }) {
  return (
    <div className="pg-features-spotlight-copy">
      <Pill icon={Focus}>In focus</Pill>
      <h2 id="pg-features-spotlight-title">{data.spotlightTitle}</h2>
      <p>{data.spotlightText}</p>
      <ul className="pg-features-checks">
        {data.bullets.map((bullet) => (
          <li key={bullet}>
            <Check aria-hidden="true" />
            {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Soft band with the catalog spotlight (title, text, four bullets) and a small
 * per-feature illustration. `artFirst` alternates the side between features.
 */
export function SpotlightBand({ slug, data }: { slug: FeatureSlug; data: DetailData }) {
  const { Art, artFirst } = spotlightArt[slug];
  return (
    <section
      className="cp-section pg-features-spotlight"
      id="spotlight"
      aria-labelledby="pg-features-spotlight-title"
      data-art-first={artFirst || undefined}
    >
      <SpotlightCopy data={data} />
      <Art />
    </section>
  );
}
