import { ArrowRight, LockKeyhole } from "lucide-react";
import { Link } from "react-router";

export default function Login() {
  return <main id="main" className="standalone-message"><LockKeyhole /><h1>Sign in to your CampusPilot workspace.</h1><p>The public website stays independent from school data. Your organization’s workspace provides the secure sign-in route.</p><Link className="marketing-button marketing-button-primary" to="/contact">Contact CampusPilot <ArrowRight /></Link></main>;
}
