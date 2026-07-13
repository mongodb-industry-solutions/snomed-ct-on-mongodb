import { Suspense } from "react";

import DemoWorkbench from "@/components/DemoWorkbench";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <DemoWorkbench />
    </Suspense>
  );
}
