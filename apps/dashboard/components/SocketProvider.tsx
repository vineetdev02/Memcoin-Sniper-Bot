"use client";

import { useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { useFeedStore } from "@/lib/store";

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const addPool = useFeedStore((s) => s.addPool);
  const addVerdict = useFeedStore((s) => s.addVerdict);
  const setStatus = useFeedStore((s) => s.setStatus);
  const setConnected = useFeedStore((s) => s.setConnected);
  const replacePools = useFeedStore((s) => s.replacePools);
  const applyVerdicts = useFeedStore((s) => s.applyVerdicts);
  const hydratePositions = useFeedStore((s) => s.hydratePositions);
  const positionOpened = useFeedStore((s) => s.positionOpened);
  const positionUpdated = useFeedStore((s) => s.positionUpdated);
  const positionClosed = useFeedStore((s) => s.positionClosed);
  const setBankroll = useFeedStore((s) => s.setBankroll);

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit("pool:replay", 50, (events) => {
        replacePools(events);
        socket.emit("verdict:replay", 50, (verdicts) => applyVerdicts(verdicts));
      });
      socket.emit("positions:list", ({ open, recentlyClosed }) => {
        hydratePositions(open, recentlyClosed);
      });
      socket.emit("bankroll:get", (snap) => setBankroll(snap));
    };

    const onDisconnect = () => setConnected(false);

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("pool:new", addPool);
    socket.on("verdict:new", addVerdict);
    socket.on("system:status", setStatus);
    socket.on("position:opened", ({ position }) => positionOpened(position));
    socket.on("position:update", ({ positionId, ...patch }) =>
      positionUpdated(positionId, patch),
    );
    socket.on("position:closed", ({ position }) => positionClosed(position));
    socket.on("bankroll:snapshot", setBankroll);

    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("pool:new", addPool);
      socket.off("verdict:new", addVerdict);
      socket.off("system:status", setStatus);
      socket.off("position:opened");
      socket.off("position:update");
      socket.off("position:closed");
      socket.off("bankroll:snapshot");
    };
  }, [
    addPool,
    addVerdict,
    setStatus,
    setConnected,
    replacePools,
    applyVerdicts,
    hydratePositions,
    positionOpened,
    positionUpdated,
    positionClosed,
    setBankroll,
  ]);

  return <>{children}</>;
}
