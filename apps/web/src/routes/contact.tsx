import { ContactPage } from "@/marketing/contact-page";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/contact";

export function meta({}: Route.MetaArgs) { return createMeta("/contact"); }

export default ContactPage;
