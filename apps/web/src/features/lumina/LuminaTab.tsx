/**
 * LuminaTab — content rendered inside the vertical rail when the
 * "LUMINA" tab is active.
 *
 * Layout fix (Billy 6/8): the rail's .left-rail__scroll has padding +
 * overflow-y:auto and .left-rail-tab-content has no height set, so the
 * ChatPanel was being sized to its own content and clipped horizontally
 * by the rail's padding. We break out of the scroll container with a
 * full-height absolute fill so Lumina owns the entire right-of-tabstrip
 * area while the rail's other tabs continue to scroll normally.
 */

import { useEffect } from "react";
import ChatPanel from "./ChatPanel.js";
import { useLumina } from "./store/luminaStore.js";

export default function LuminaTab(_props: { width: number }) {
  const { setTabOpen } = useLumina();

  useEffect(() => {
    setTabOpen(true);
    return () => setTabOpen(false);
  }, [setTabOpen]);

  // The rail mounts us inside a full-height flex column (see LeftRail.tsx),
  // so ChatPanel can just claim 100% of its parent.
  return <ChatPanel />;
}
