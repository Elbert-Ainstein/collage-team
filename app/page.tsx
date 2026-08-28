"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The real app is Collage-Team (Supabase-backed). Land there.
export default function Home() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/ck");
  }, [router]);
  return null;
}
