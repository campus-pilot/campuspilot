import { CalendarDays, Mail, MessageCircle, Phone } from "lucide-react";
import { env } from "@campuspilot/env/web.client";

import { MarketingPage } from "./components";

const whatsappText = "Hi Shubham, I would like to know more about CampusPilot and book a demo for my school.";

export function ContactPage() {
  return (
    <MarketingPage>
      <section className="contact-hero">
        <div className="marketing-container">
          <span>Talk to CampusPilot</span>
          <h1>Reach us the way<br />you already work.</h1>
          <p>WhatsApp and phone are fastest. Email works well for detailed enquiries.</p>
          <div className="contact-cards">
            <a className="recommended" href={`https://wa.me/${env.VITE_WHATSAPP_NUMBER}?text=${encodeURIComponent(whatsappText)}`} target="_blank" rel="noreferrer"><MessageCircle /><small>RECOMMENDED</small><h2>WhatsApp</h2><p>Start with a quick message.</p><b>{env.VITE_WHATSAPP_LABEL}</b></a>
            <a href={`tel:${env.VITE_CONTACT_PHONE_NUMBER}`}><Phone /><small>SPEAK DIRECTLY</small><h2>Call</h2><p>Tell us what you want to improve.</p><b>{env.VITE_CONTACT_PHONE_LABEL}</b></a>
            <a href={`mailto:${env.VITE_CONTACT_EMAIL}?subject=${encodeURIComponent("CampusPilot demo for my school")}`}><Mail /><small>SHARE THE DETAILS</small><h2>Email</h2><p>Send your school setup and priorities.</p><b>{env.VITE_CONTACT_EMAIL}</b></a>
          </div>
        </div>
      </section>
      <section className="calendar-section">
        <div className="marketing-container">
          <div className="calendar-heading"><span><CalendarDays /> Prefer to schedule?</span><h2>Choose a convenient time.</h2><p>Book a focused CampusPilot walkthrough.</p></div>
          <div className="calendar-frame"><iframe title="Schedule a CampusPilot demo" src={env.VITE_CALENDAR_URL} loading="lazy" /></div>
        </div>
      </section>
    </MarketingPage>
  );
}
