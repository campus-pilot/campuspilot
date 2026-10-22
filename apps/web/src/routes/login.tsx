import { env } from "@campuspilot/env/web.client";
import { ArrowRight, GraduationCap, LockKeyhole, Users } from "lucide-react";
import { Link } from "react-router";

import { MarketingFooter } from "@/marketing/components";

import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Log in to CampusPilot" },
    { name: "description", content: "Choose the CampusPilot workspace for students and families or school staff." },
    { name: "robots", content: "noindex, follow" },
  ];
}

export default function Login() {
  return (
    <>
      <main id="main" className="login-choice-page">
        <section className="marketing-container login-choice-shell">
          <div className="login-choice-intro"><span><LockKeyhole /> Secure access</span><h1>Choose your<br />CampusPilot login.</h1><p>Students, families, and school teams use separate workspaces so every person sees only what belongs to them.</p></div>
          <div className="login-choice-grid">
            <a href={env.VITE_STUDENT_LOGIN_URL}><GraduationCap /><small>STUDENTS & FAMILIES</small><h2>Login as student</h2><p>View personal academics, results, fees, notices, and documents.</p><span>Continue <ArrowRight /></span></a>
            <a href={env.VITE_STAFF_LOGIN_URL}><Users /><small>SCHOOL TEAMS</small><h2>Login as staff</h2><p>Open the management workspace for authorized school operations.</p><span>Continue <ArrowRight /></span></a>
          </div>
          <Link className="login-back-link" to="/">Back to CampusPilot</Link>
        </section>
      </main>
      <MarketingFooter />
    </>
  );
}
