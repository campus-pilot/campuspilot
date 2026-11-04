import { env } from "@campuspilot/env/web.client";
import { Mail, MessageCircle, Phone, type LucideIcon } from "lucide-react";

/**
 * The pre-filled WhatsApp message, carried over unchanged from the previous site
 * so the team receiving it recognises where the enquiry came from.
 */
export const WHATSAPP_MESSAGE = "Hi Shubham, I would like to know more about CampusPilot and book a demo for my school.";

/** Subject line for every email link on the site's contact surfaces. */
export const EMAIL_SUBJECT = "CampusPilot demo for my school";

export type ChannelId = "whatsapp" | "phone" | "email";

export type Channel = {
  id: ChannelId;
  icon: LucideIcon;
  /** Channel name ("WhatsApp"). */
  name: string;
  /** Human-readable destination from env (number label or address). */
  value: string;
  href: string;
  /** Short verb phrase for the link's call to action ("Message us"). */
  action: string;
  /**
   * Whether the link leaves the site in a new tab. Only WhatsApp does; `tel:`
   * and `mailto:` hand off to the device's own app instead.
   */
  external: boolean;
};

/**
 * Every contact destination comes from `@campuspilot/env` (the same `VITE_*`
 * variables the Dockerfile and release workflow pass), never from literals, so
 * a number or address change is a deploy-time setting rather than a code change.
 */
export const channels: Record<ChannelId, Channel> = {
  whatsapp: {
    id: "whatsapp",
    icon: MessageCircle,
    name: "WhatsApp",
    value: env.VITE_WHATSAPP_LABEL,
    href: `https://wa.me/${env.VITE_WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`,
    action: "Message us",
    external: true,
  },
  phone: {
    id: "phone",
    icon: Phone,
    name: "Call",
    value: env.VITE_CONTACT_PHONE_LABEL,
    href: `tel:${env.VITE_CONTACT_PHONE_NUMBER}`,
    action: "Call now",
    external: false,
  },
  email: {
    id: "email",
    icon: Mail,
    name: "Email",
    value: env.VITE_CONTACT_EMAIL,
    href: `mailto:${env.VITE_CONTACT_EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECT)}`,
    action: "Write to us",
    external: false,
  },
};

/** Display order everywhere: the recommended channel first. */
export const channelOrder: readonly ChannelId[] = ["whatsapp", "phone", "email"];

/** Scheduling page embedded on `/book-demo` and linked as its new-tab fallback. */
export const calendarUrl = env.VITE_CALENDAR_URL;

/** Anchor attributes for a channel link: new tab only for external channels. */
export function channelTarget(channel: Channel) {
  return channel.external ? ({ target: "_blank", rel: "noreferrer" } as const) : {};
}
