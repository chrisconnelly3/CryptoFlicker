"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "cryptoflicker:favorites";

export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setFavorites(new Set(JSON.parse(stored)));
      }
    } catch {
      // ignore
    }
    setLoaded(true);
  }, []);

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback((symbol: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) {
        next.delete(symbol);
      } else {
        next.add(symbol);
      }
      persist(next);
      return next;
    });
  }, [persist]);

  const isFavorite = useCallback(
    (symbol: string) => favorites.has(symbol),
    [favorites]
  );

  const exportFavorites = useCallback((): string => {
    return JSON.stringify([...favorites]);
  }, [favorites]);

  const importFavorites = useCallback(
    (json: string) => {
      try {
        const arr: string[] = JSON.parse(json);
        if (Array.isArray(arr)) {
          const next = new Set(arr.filter((s) => typeof s === "string"));
          setFavorites(next);
          persist(next);
        }
      } catch {
        // ignore
      }
    },
    [persist]
  );

  return { favorites, loaded, toggle, isFavorite, exportFavorites, importFavorites };
}
