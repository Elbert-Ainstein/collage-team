"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "@/store";

// Role-aware landing redirect (routing is file-based; role is persisted client state).
export default function Home() {
  const router = useRouter();
  const role = useStore((s) => s.role);
  useEffect(() => {
    router.replace(role === "instructor" ? "/i/create" : "/s/activities");
  }, [role, router]);
  return null;
}
