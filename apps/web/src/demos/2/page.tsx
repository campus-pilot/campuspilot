import { EventStreamSection } from "./event-stream";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { Navbar } from "./navbar";
import { ProductTabsSection } from "./product-tabs";

/** Experimental page `/2`: navbar → hero → event stream → tabbed product section → footer. */
export function DemoPage() {
  return (
    <div className="d2-page">
      <a className="d2-skip" href="#d2-main">Skip to content</a>
      <Navbar />
      <main id="d2-main">
        <Hero />
        <EventStreamSection />
        <ProductTabsSection />
      </main>
      <Footer />
    </div>
  );
}
