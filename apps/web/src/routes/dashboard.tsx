import { ArrowRight, LayoutDashboard } from "lucide-react";
import { Link } from "react-router";

export default function Dashboard() {
  return <main id="main" className="standalone-message"><LayoutDashboard /><h1>The CampusPilot workspace lives in the management app.</h1><p>This public website runs independently and does not connect to a school’s private data.</p><Link className="marketing-button marketing-button-primary" to="/book-demo">Book a demo <ArrowRight /></Link></main>;
}
