import { ContactPage } from "@/marketing/contact-page";
import { createMeta } from "@/marketing/seo";

import type { Route } from "./+types/book-demo";

export function meta({}: Route.MetaArgs) { return createMeta("/book-demo"); }

export default ContactPage;
