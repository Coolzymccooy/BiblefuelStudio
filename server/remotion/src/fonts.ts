import { useState } from "react";
import { loadFont } from "@remotion/fonts";
import type { RenderData } from "./types";

export const SANS = "BF Sans";
export const SERIF = "BF Serif";
export const SERIF_ITALIC = "BF Serif Italic";

/**
 * Load the caption fonts once per page from the URLs the render staged.
 * loadFont holds the render (delayRender) until each face is ready, so no
 * frame is captured in a fallback font.
 */
export function useFonts(fonts: RenderData["fonts"]) {
  useState(() => {
    if (fonts.sans) loadFont({ family: SANS, url: fonts.sans, weight: "100 900" });
    if (fonts.serif) loadFont({ family: SERIF, url: fonts.serif, weight: "300 700" });
    if (fonts.serifItalic) loadFont({ family: SERIF_ITALIC, url: fonts.serifItalic, weight: "300 700", style: "italic" });
    return true;
  });
}
