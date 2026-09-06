"use client";

import { useEffect, useId, useRef } from "react";
import type mapboxgl from "mapbox-gl";
import { aerialMovementArrowGeometry } from "@/lib/map/aerialMovementArrow";

export function AerialMovementArrow({
  map,
  from,
  to,
  visible,
}: {
  map: mapboxgl.Map | null;
  from: [number, number] | null;
  to: [number, number] | null;
  visible: boolean;
}) {
  const markerId = `movement-arrow-${useId().replaceAll(":", "")}`;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const outlineRef = useRef<SVGPathElement | null>(null);
  const arrowRef = useRef<SVGPathElement | null>(null);
  const sourceRef = useRef<SVGCircleElement | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    const outline = outlineRef.current;
    const arrow = arrowRef.current;
    const source = sourceRef.current;
    if (!svg || !outline || !arrow || !source) return;
    if (!map || !visible || !from || !to) {
      svg.style.display = "none";
      return;
    }

    let animationFrame: number | null = null;
    const draw = () => {
      animationFrame = null;
      const container = map.getContainer();
      const projectedFrom = map.project(from);
      const projectedTo = map.project(to);
      const geometry = aerialMovementArrowGeometry({
        from: { x: projectedFrom.x, y: projectedFrom.y },
        to: { x: projectedTo.x, y: projectedTo.y },
        mapWidth: container.clientWidth,
        mapHeight: container.clientHeight,
      });
      if (!geometry) {
        svg.style.display = "none";
        return;
      }

      const path = `M ${geometry.start.x} ${geometry.start.y} C ${geometry.control1.x} ${geometry.control1.y}, ${geometry.control2.x} ${geometry.control2.y}, ${geometry.end.x} ${geometry.end.y}`;
      outline.setAttribute("d", path);
      arrow.setAttribute("d", path);
      if (geometry.destinationVisible) arrow.setAttribute("marker-end", `url(#${markerId})`);
      else arrow.removeAttribute("marker-end");
      source.setAttribute("cx", String(geometry.start.x));
      source.setAttribute("cy", String(geometry.start.y));
      source.style.display = geometry.sourceVisible ? "" : "none";
      svg.style.display = "";
    };
    const scheduleDraw = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(draw);
    };

    draw();
    map.on("move", scheduleDraw);
    map.on("resize", scheduleDraw);
    return () => {
      map.off("move", scheduleDraw);
      map.off("resize", scheduleDraw);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
    };
  }, [from, map, markerId, to, visible]);

  return (
    <svg
      ref={svgRef}
      aria-hidden
      style={{ display: "none" }}
      className="pointer-events-none absolute inset-0 z-[4] size-full overflow-hidden"
    >
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 24 24"
          refX="21"
          refY="12"
          markerWidth="30"
          markerHeight="30"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path
            d="M 2 2 L 22 12 L 2 22 Z"
            fill="#d97706"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
      <g style={{ filter: "drop-shadow(0 7px 5px rgba(15, 23, 42, 0.26))" }}>
        <path ref={outlineRef} fill="none" stroke="rgba(255,255,255,0.94)" strokeWidth="15" strokeLinecap="round" />
        <path ref={arrowRef} fill="none" stroke="#d97706" strokeWidth="8" strokeLinecap="round" />
        <circle ref={sourceRef} r="7" fill="#ffffff" stroke="#d97706" strokeWidth="4" />
      </g>
    </svg>
  );
}
