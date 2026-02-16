"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "cryptoflicker:favorites";
const NOTES_KEY = "cryptoflicker:favnotes";
const MIGRATED_KEY = "cryptoflicker:favs_migrated_v2";

/**
 * Migrate old bare-symbol favorites to namespaced format.
 * Old format: ["BTCUSDT", "ETHUSDT"]
 * New format: ["crypto:BTCUSDT", "crypto:ETHUSDT"]
 *
 * Old notes: { "BTCUSDT": "moon soon" }
 * New notes: { "crypto:BTCUSDT": "moon soon" }
 */
function migrateIfNeeded() {
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;

    const storedFavs = localStorage.getItem(STORAGE_KEY);
    if (storedFavs) {
      const parsed: string[] = JSON.parse(storedFavs);
      const migrated = parsed.map((s) =>
        s.includes(":") ? s : `crypto:${s}`,
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }

    const storedNotes = localStorage.getItem(NOTES_KEY);
    if (storedNotes) {
      const parsed: Record<string, string> = JSON.parse(storedNotes);
      const migrated: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const key = k.includes(":") ? k : `crypto:${k}`;
        migrated[key] = v;
      }
      localStorage.setItem(NOTES_KEY, JSON.stringify(migrated));
    }

    localStorage.setItem(MIGRATED_KEY, "1");
  } catch {
    // ignore
  }
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    migrateIfNeeded();

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setFavorites(new Set(JSON.parse(stored)));
      }
      const storedNotes = localStorage.getItem(NOTES_KEY);
      if (storedNotes) {
        const parsed: Record<string, string> = JSON.parse(storedNotes);
        setNotes(new Map(Object.entries(parsed)));
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  const persistFavs = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  }, []);

  const persistNotes = useCallback((next: Map<string, string>) => {
    try {
      const obj: Record<string, string> = {};
      next.forEach((v, k) => {
        obj[k] = v;
      });
      localStorage.setItem(NOTES_KEY, JSON.stringify(obj));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(
    (key: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        persistFavs(next);
        return next;
      });
    },
    [persistFavs],
  );

  const isFavorite = useCallback(
    (key: string) => favorites.has(key),
    [favorites],
  );

  const getNote = useCallback(
    (key: string) => notes.get(key) ?? "",
    [notes],
  );

  const setNote = useCallback(
    (key: string, note: string) => {
      setNotes((prev) => {
        const next = new Map(prev);
        if (note.trim()) {
          next.set(key, note.trim());
        } else {
          next.delete(key);
        }
        persistNotes(next);
        return next;
      });
    },
    [persistNotes],
  );

  const exportFavorites = useCallback((): string => {
    const notesObj: Record<string, string> = {};
    notes.forEach((v, k) => {
      notesObj[k] = v;
    });
    return JSON.stringify({ favorites: [...favorites], notes: notesObj });
  }, [favorites, notes]);

  const importFavorites = useCallback(
    (json: string) => {
      try {
        const parsed = JSON.parse(json);
        if (Array.isArray(parsed)) {
          // Old format: bare array of symbols - assume crypto
          const next = new Set(
            parsed
              .filter((s: unknown) => typeof s === "string")
              .map((s: string) => (s.includes(":") ? s : `crypto:${s}`)),
          );
          setFavorites(next);
          persistFavs(next);
        } else if (parsed && Array.isArray(parsed.favorites)) {
          const next = new Set<string>(
            (parsed.favorites as unknown[])
              .filter((s): s is string => typeof s === "string")
              .map((s) => (s.includes(":") ? s : `crypto:${s}`)),
          );
          setFavorites(next);
          persistFavs(next);
          if (parsed.notes && typeof parsed.notes === "object") {
            const migratedNotes: Record<string, string> = {};
            for (const [k, v] of Object.entries(
              parsed.notes as Record<string, string>,
            )) {
              const key = k.includes(":") ? k : `crypto:${k}`;
              migratedNotes[key] = v;
            }
            const nextNotes = new Map<string, string>(
              Object.entries(migratedNotes),
            );
            setNotes(nextNotes);
            persistNotes(nextNotes);
          }
        }
      } catch {
        // ignore
      }
    },
    [persistFavs, persistNotes],
  );

  return {
    favorites,
    notes,
    loaded,
    toggle,
    isFavorite,
    getNote,
    setNote,
    exportFavorites,
    importFavorites,
  };
}
