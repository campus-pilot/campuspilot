import { createMeta } from "@/site/seo";
import { ProductPage } from "@/pages/product/page";
import pageStyles from "@/pages/product/page.css?url";

import type { Route } from "./+types/_site.product";

export function meta({}: Route.MetaArgs) {
  return createMeta("/product");
}

export const links: Route.LinksFunction = () => [{ rel: "stylesheet", href: pageStyles }];

export default function ProductRoute() {
  return <ProductPage />;
}
