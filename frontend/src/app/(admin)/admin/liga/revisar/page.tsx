"use client";

import { Suspense } from "react";
import Revisar from "./Revisar";

export default function RevisarAdmin() {
  return <Suspense fallback={null}><Revisar /></Suspense>;
}
