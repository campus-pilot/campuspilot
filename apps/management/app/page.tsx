"use client";

import dynamic from "next/dynamic";

const ManagementApp = dynamic(() => import("@/components/management-app"), {
  ssr: false,
});

export default function HomePage() {
  return <ManagementApp />;
}
