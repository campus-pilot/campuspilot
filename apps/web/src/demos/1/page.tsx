import { FaqSection } from "./faq";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Navbar } from "./navbar";
import { StepsSection } from "./steps";

/**
 * Experimental marketing page `/1`: a calm, black-and-white layout inspired by
 * minimal scheduling sites. The `d1-frame` draws the thin vertical guide lines
 * that hold the sections together.
 */
export function DemoOnePage() {
  return (
    <div className="d1-page">
      <a className="d1-skip" href="#d1-main">Skip to content</a>
      <Navbar />
      <div className="d1-frame">
        <main id="d1-main">
          <Hero />
          <StepsSection />
          <FaqSection />
        </main>
        <Footer />
      </div>
    </div>
  );
}
