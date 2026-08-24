import { useEffect, useState } from "react";
import { store } from "../store/telemetryStore";

const SYNC_INTERVAL_MS = 250; // ~4 Hz

/**
 * useTelemetrySync
 * Reads the mutable store on an interval and returns a plain snapshot
 * for React components (sidebar, HUD). The map itself never uses this —
 * it reads the store directly in its rAF loop.
 */
export function useTelemetrySync() {
  const [snapshot, setSnapshot] = useState({
    drone: null,
    objects: [],
    connected: false,
    frameCount: 0,
    lastFrameIndex: null,
  });

  useEffect(() => {
    const id = setInterval(() => {
      setSnapshot({
        drone: store.drone,
        objects: Array.from(store.objects.values()),
        connected: store.connected,
        frameCount: store.frameCount,
        lastFrameIndex: store.lastFrameIndex,
      });
    }, SYNC_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  return snapshot;
}
