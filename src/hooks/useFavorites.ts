"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "cryptoflicker:favorites";
const NOTES_KEY = "cryptoflicker:favnotes";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
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
    (symbol: string) => {
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(symbol)) {
          next.delete(symbol);
        } else {
          next.add(symbol);
        }
        persistFavs(next);
        return next;
      });
    },
    [persistFavs]
  );

  const isFavorite = useCallback(
    (symbol: string) => favorites.has(symbol),
    [favorites]
  );

  const getNote = useCallback(
    (symbol: string) => notes.get(symbol) ?? "",
    [notes]
  );

  const setNote = useCallback(
    (symbol: string, note: string) => {
      setNotes((prev) => {
        const next = new Map(prev);
        if (note.trim()) {
          next.set(symbol, note.trim());
        } else {
          next.delete(symbol);
        }
        persistNotes(next);
        return next;
      });
    },
    [persistNotes]
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
        // Support both old format (array) and new format (object with favorites + notes)
        if (Array.isArray(parsed)) {
          const next = new Set(parsed.filter((s: unknown) => typeof s === "string"));
          setFavorites(next);
          persistFavs(next);
        } else if (parsed && Array.isArray(parsed.favorites)) {
          const next = new Set<string>(
            (parsed.favorites as unknown[]).filter((s): s is string => typeof s === "string")
          );
          setFavorites(next);
          persistFavs(next);
          if (parsed.notes && typeof parsed.notes === "object") {
            const nextNotes = new Map<string, string>(
              Object.entries(parsed.notes as Record<string, string>)
            );
            setNotes(nextNotes);
            persistNotes(nextNotes);
          }
        }
      } catch {
        // ignore
      }
    },
    [persistFavs, persistNotes]
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
