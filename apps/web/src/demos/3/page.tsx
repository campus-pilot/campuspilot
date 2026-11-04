import { ConnectDots } from "./connect-dots";
import { DoneOnce } from "./done-once";
import { SketchFilters } from "./doodles";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Navbar } from "./navbar";

/** `/3` — "sketchbook" experiment: navbar → hero → two sections → footer. */
export function SketchbookPage() {
  return (
    <div className="d3-page">
      <SketchFilters />
      <a className="d3-skip" href="#d3-main">Skip to content</a>
      <Navbar />
      <main id="d3-main">
        <Hero />
        <ConnectDots />
        <DoneOnce />
      </main>
      <Footer />
    </div>
  );
}
