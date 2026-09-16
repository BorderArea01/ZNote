globalThis.ZNotePreviewLayout = (viewport, rect, image, preferred, controlsHeight = 118) => {
  const margin = 12,
    gap = 18,
    chromeHeight = controlsHeight;
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
    .filter((v) => v.width >= Math.min(120,image.width) && v.height >= Math.min(65,image.height) && v.area.width >= Math.max(Math.min(240,bounds.width),v.width+18) && v.area.height >= v.height+chromeHeight)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  const choice = candidates[0] || { area: bounds, ...size(bounds) };
  const width = Math.max(Math.min(240,bounds.width),choice.width+18),
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
    containerWidth: width,
    height: choice.height,
    overlaps: !candidates.length,
  };
};
