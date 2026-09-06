export type MapScreenPoint = { x: number; y: number };

export type AerialMovementArrowGeometry = {
  start: MapScreenPoint;
  control1: MapScreenPoint;
  control2: MapScreenPoint;
  end: MapScreenPoint;
  sourceVisible: boolean;
  destinationVisible: boolean;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 画面上で上空へ持ち上がるアーチを作る。
 * 端を架空の出発地・到着地に見せず、画面外にある側は線だけを外へ抜く。
 */
export function aerialMovementArrowGeometry({
  from,
  to,
  mapWidth,
  mapHeight,
  edgePadding = 28,
}: {
  from: MapScreenPoint;
  to: MapScreenPoint;
  mapWidth: number;
  mapHeight: number;
  edgePadding?: number;
}): AerialMovementArrowGeometry | null {
  const minX = edgePadding;
  const maxX = Math.max(minX, mapWidth - edgePadding);
  const minY = edgePadding;
  const maxY = Math.max(minY, mapHeight - edgePadding);
  const sourceVisible = from.x >= minX && from.x <= maxX && from.y >= minY && from.y <= maxY;
  const destinationVisible = to.x >= minX && to.x <= maxX && to.y >= minY && to.y <= maxY;
  const rawDx = to.x - from.x;
  const rawDy = to.y - from.y;
  const rawDistance = Math.hypot(rawDx, rawDy);
  if (rawDistance < 48) return null;

  const unitX = rawDx / rawDistance;
  const unitY = rawDy / rawDistance;
  let entryT = 0;
  let exitT = 1;
  const clipTests: Array<[number, number]> = [
    [-rawDx, from.x - minX],
    [rawDx, maxX - from.x],
    [-rawDy, from.y - minY],
    [rawDy, maxY - from.y],
  ];
  for (const [direction, distanceToEdge] of clipTests) {
    if (direction === 0) {
      if (distanceToEdge < 0) return null;
      continue;
    }
    const ratio = distanceToEdge / direction;
    if (direction < 0) entryT = Math.max(entryT, ratio);
    else exitT = Math.min(exitT, ratio);
    if (entryT > exitT) return null;
  }

  let visibleStart = { x: from.x + rawDx * entryT, y: from.y + rawDy * entryT };
  const visibleEnd = { x: from.x + rawDx * exitT, y: from.y + rawDy * exitT };
  const startInset = Math.min(38, rawDistance * 0.1);
  let start: MapScreenPoint;
  if (sourceVisible) {
    start = {
      x: clamp(from.x + unitX * startInset, minX, maxX),
      y: clamp(from.y + unitY * startInset - Math.min(24, rawDistance * 0.06), minY, maxY),
    };
    visibleStart = start;
  } else {
    start = { x: visibleStart.x - unitX * 96, y: visibleStart.y - unitY * 96 };
  }

  const end = destinationVisible
    ? { x: to.x, y: to.y }
    : { x: visibleEnd.x + unitX * 96, y: visibleEnd.y + unitY * 96 };
  const visibleDistance = Math.hypot(visibleEnd.x - visibleStart.x, visibleEnd.y - visibleStart.y);
  if (visibleDistance < 44) return null;

  const lift = clamp(visibleDistance * 0.22, 64, 120);
  const skyY = Math.max(minY + 20, Math.min(visibleStart.y, visibleEnd.y) - lift);
  return {
    start,
    control1: { x: visibleStart.x + (visibleEnd.x - visibleStart.x) * 0.28, y: skyY },
    control2: { x: visibleStart.x + (visibleEnd.x - visibleStart.x) * 0.82, y: skyY },
    end,
    sourceVisible,
    destinationVisible,
  };
}
