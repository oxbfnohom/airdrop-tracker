"use client";

import { useEffect } from "react";

/** Daftarin service worker — syarat biar PWA bisa di-install di HP. */
export default function PWARegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      const t = setTimeout(() => void navigator.serviceWorker.register("/sw.js").catch(() => {}), 1500);
      return () => clearTimeout(t);
    }
  }, []);
  return null;
}