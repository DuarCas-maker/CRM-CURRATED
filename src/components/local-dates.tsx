"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { dateLabel, type Locale } from "@/lib/domain";

// Match the server during hydration; switch to the viewer's zone after mount.
const LocalTimeZone = createContext("UTC");
export function LocalDates({ children }: { children: ReactNode }) {
  const [zone, setZone] = useState("UTC");
  useEffect(() => {
    setZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  return (
    <LocalTimeZone.Provider value={zone}>{children}</LocalTimeZone.Provider>
  );
}
export const useLocalTimeZone = () => useContext(LocalTimeZone);
export function useLocalDateLabel() {
  const zone = useLocalTimeZone();
  return (value: string | null, locale: Locale, withTime = false) =>
    dateLabel(value, locale, withTime, zone);
}
