/**
 * LuminaTab — content rendered inside the vertical rail when the
 * "LUMINA" tab is active. Thin wrapper around ChatPanel that also keeps
 * luminaStore.tabOpen in sync so the orb can reflect tab state.
 */

import { useEffect } from "react";
import ChatPanel from "./ChatPanel.js";
import { useLumina } from "./store/luminaStore.js";

export default function LuminaTab({ width }: { width: number }) {
  const { setTabOpen } = useLumina();

  useEffect(() => {
    setTabOpen(true);
    return () => setTabOpen(false);
  }, [setTabOpen]);

  return <ChatPanel width={width} />;
}
