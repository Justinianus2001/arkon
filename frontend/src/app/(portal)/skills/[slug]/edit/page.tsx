"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SkillEditRedirect() {
  const { slug } = useParams();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/skills/${slug}`);
  }, [slug, router]);

  return null;
}
