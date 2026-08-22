"use client";

import { useLayoutEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

type ConnectorLayout = {
  height: number;
  sourceY: number;
  targetYs: number[];
};

export function CourseFlowConnector({
  sourceRef,
  targetRef,
  targetKeys,
  usesCycles,
}: {
  sourceRef: React.RefObject<HTMLElement | null>;
  targetRef: React.RefObject<HTMLElement | null>;
  targetKeys: Array<string | number>;
  usesCycles: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const [connectorElement, setConnectorElement] = useState<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<ConnectorLayout>({ height: 1, sourceY: 0, targetYs: [] });
  const [ready, setReady] = useState(false);
  const targetSignature = targetKeys.join("|");
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };

  useLayoutEffect(() => {
    const source = sourceRef.current;
    const targetContainer = targetRef.current;
    if (!source || !targetContainer || !connectorElement) return;

    let animationFrame = 0;
    const measure = () => {
      const connectorRect = connectorElement.getBoundingClientRect();
      const sourceRect = source.getBoundingClientRect();
      const targets = Array.from(targetContainer.querySelectorAll<HTMLElement>("[data-flow-target]"));
      const next: ConnectorLayout = {
        height: Math.max(1, connectorRect.height),
        sourceY: sourceRect.top + sourceRect.height / 2 - connectorRect.top,
        targetYs: targets.map((target) => {
          const rect = target.getBoundingClientRect();
          return rect.top + rect.height / 2 - connectorRect.top;
        }),
      };
      setLayout((current) => {
        const unchanged = Math.abs(current.height - next.height) < 0.5
          && Math.abs(current.sourceY - next.sourceY) < 0.5
          && current.targetYs.length === next.targetYs.length
          && current.targetYs.every((value, index) => Math.abs(value - next.targetYs[index]) < 0.5);
        return unchanged ? current : next;
      });
      setReady(true);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(source);
    observer.observe(targetContainer);
    observer.observe(connectorElement);
    measure();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [connectorElement, sourceRef, targetRef, targetSignature]);

  const sourceY = layout.sourceY;
  const targets = targetKeys.map((key, index) => ({ key, y: layout.targetYs[index] ?? sourceY }));
  const positionsReady = ready && layout.targetYs.length === targets.length;
  const spineTop = Math.min(sourceY, ...targets.map((target) => target.y));
  const spineBottom = Math.max(sourceY, ...targets.map((target) => target.y));

  return (
    <div ref={setConnectorElement} className="relative hidden self-stretch xl:block" aria-hidden="true">
      <span
        className="absolute -left-1.5 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white"
        style={{ top: sourceY, opacity: ready ? 1 : 0 }}
      />
      <svg
        viewBox={`0 0 72 ${layout.height}`}
        className="absolute inset-0 h-full w-full overflow-visible"
        preserveAspectRatio="none"
        style={{ opacity: positionsReady ? 1 : 0 }}
      >
        <defs>
          <marker id="course-settings-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L8,4 L0,8 Z" fill="#cbd5e1" />
          </marker>
        </defs>
        {positionsReady && (usesCycles ? (
          <>
            <motion.path initial={false} animate={{ d: `M0 ${sourceY} H34` }} transition={motionTransition} fill="none" stroke="#cbd5e1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <motion.path initial={false} animate={{ d: `M34 ${spineTop} V${spineBottom}` }} transition={motionTransition} fill="none" stroke="#cbd5e1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {targets.map((target) => (
              <motion.path
                key={target.key}
                initial={{ d: `M34 ${target.y} H68`, opacity: reduceMotion ? 1 : 0, pathLength: reduceMotion ? 1 : 0 }}
                animate={{ d: `M34 ${target.y} H68`, opacity: 1, pathLength: 1 }}
                transition={motionTransition}
                fill="none"
                stroke="#cbd5e1"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                markerEnd="url(#course-settings-flow-arrow)"
              />
            ))}
          </>
        ) : (
          <motion.path
            initial={false}
            animate={{ d: `M0 ${sourceY} H34 V${targets[0]?.y ?? sourceY} H68` }}
            transition={motionTransition}
            fill="none"
            stroke="#cbd5e1"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            markerEnd="url(#course-settings-flow-arrow)"
          />
        ))}
      </svg>
    </div>
  );
}
