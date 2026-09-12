globalThis.ZNotePreviewLayout = (viewport, rect, image, preferred) => {
  const margin = 12,
    gap = 18,
    chromeHeight = 118;
  const bounds = {
    left: margin,
    top: margin,
    width: viewport.width - margin * 2,
    height: viewport.height - margin * 2,
  };
  const areas = [
    {
      left: rect.right + gap,
      top: margin,
      width: viewport.width - rect.right - gap - margin,
      height: bounds.height,
    },
    {
      left: margin,
      top: margin,
      width: rect.left - gap - margin,
      height: bounds.height,
    },
    {
      left: margin,
      top: rect.bottom + gap,
      width: bounds.width,
      height: viewport.height - rect.bottom - gap - margin,
    },
    {
      left: margin,
      top: margin,
      width: bounds.width,
      height: rect.top - gap - margin,
    },
  ];
  const size = (area) => {
    const scale = Math.min(
      1,
      preferred / image.width,
      (area.width - 18) / image.width,
      (area.height - chromeHeight) / image.height,
    );
    return {
      width: Math.max(0, Math.floor(image.width * scale)),
      height: Math.max(0, Math.floor(image.height * scale)),
    };
  };
  const candidates = areas
    .map((area) => ({ area, ...size(area) }))
    .filter((v) => v.width >= 120 && v.height >= 65)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const choice = candidates[0] || { area: bounds, ...size(bounds) };
  const width = choice.width + 18,
    height = choice.height + chromeHeight;
  return {
    left: Math.max(
      margin,
      Math.min(choice.area.left, viewport.width - width - margin),
    ),
    top: Math.max(
      choice.area.top,
      Math.min(rect.top, choice.area.top + choice.area.height - height),
    ),
    width: choice.width,
    height: choice.height,
    overlaps: !candidates.length,
  };
};
