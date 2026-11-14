import { ArrowRight, Sparkles } from "lucide-react";
import { Link } from "react-router";

/**
 * Site-wide launch announcement, rendered under the fixed navbar on every page.
 * It is deliberately not dismissible, so there is no stored state. Retire it by
 * removing it from `SiteShell` once the launch is no longer news.
 */
export function AnnouncementBar() {
  return (
    <aside className="cp-announce" aria-label="Announcement">
      <Link to="/features/question-papers">
        <Sparkles aria-hidden="true" />
        <span>
          <b>Question paper generation is now live.</b> Turn a handwritten draft into a printed paper with AI.
        </span>
        <span className="cp-announce-cta">
          Learn more <ArrowRight aria-hidden="true" />
        </span>
      </Link>
    </aside>
  );
}
