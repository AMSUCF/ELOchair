const segmenters = new Map<string, Intl.Segmenter>();

function segmenterFor(lang: string): Intl.Segmenter {
  let seg = segmenters.get(lang);
  if (!seg) {
    seg = new Intl.Segmenter(lang, { granularity: "word" });
    segmenters.set(lang, seg);
  }
  return seg;
}

/**
 * Count words the way a reader would, in any language. Uses Intl.Segmenter so that
 * punctuation is ignored and languages without spaces (Japanese, Chinese) still count.
 */
export function countWords(text: string, lang = "en"): number {
  let n = 0;
  for (const s of segmenterFor(lang).segment(text)) if (s.isWordLike) n++;
  return n;
}
