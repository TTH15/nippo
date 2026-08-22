"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { faAmazon } from "@fortawesome/free-brands-svg-icons";
import {
  faArchive,
  faArrowLeft,
  faChevronDown,
  faClock,
  faCoins,
  faGear,
  faPalette,
  faPlus,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";
import { DigitInput } from "@/lib/components/DigitInput";

type CycleDraft = {
  id: number;
  label: string;
  meetingTime: string;
  arrivalTime: string;
  endTime: string;
  meetingPlace: string;
  maxDrivers: number | null;
};

type ConnectorLayout = {
  height: number;
  sourceY: number;
  targetYs: number[];
};

const RECOMMENDED_COLORS = [
  "#2563eb", "#0891b2", "#0f766e", "#16a34a", "#84cc16",
  "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#7c3aed",
];

const INITIAL_CYCLES: CycleDraft[] = [
  { id: 1, label: "C1", meetingTime: "08:00", arrivalTime: "08:30", endTime: "15:00", meetingPlace: "", maxDrivers: null },
  { id: 2, label: "C2", meetingTime: "15:00", arrivalTime: "15:30", endTime: "21:00", meetingPlace: "", maxDrivers: null },
];

const inputClass = "w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-xs font-medium text-slate-500">{children}</span>;
}

function SelectField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <FieldLabel>{label}</FieldLabel>
      <span className="relative block">
        <select value={value} onChange={() => undefined} className={`${inputClass} appearance-none pr-10`}>
          <option>{value}</option>
        </select>
        <FontAwesomeIcon icon={faChevronDown} className="pointer-events-none absolute right-3.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
      </span>
    </label>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  const normalizeText = (raw: string) => raw
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[^0-9:]/g, "")
    .slice(0, 5);
  const parse = (raw: string) => {
    const normalized = normalizeText(raw);
    const digits = normalized.replace(/:/g, "");
    if (!digits) return null;
    const hourText = normalized.includes(":") ? normalized.split(":")[0] : digits.length <= 2 ? digits : digits.slice(0, -2);
    const minuteText = normalized.includes(":") ? normalized.split(":")[1] : digits.length <= 2 ? "0" : digits.slice(-2);
    return {
      hour: Math.min(23, Number(hourText) || 0),
      minute: Math.min(59, Number(minuteText) || 0),
    };
  };
  const commit = () => {
    const parsed = parse(text);
    const next = parsed ? `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}` : "";
    setText(next);
    onChange(next);
  };
  const moveByFiveMinutes = (direction: 1 | -1) => {
    const parsed = parse(text) ?? { hour: 0, minute: 0 };
    const total = (parsed.hour * 60 + parsed.minute + direction * 5 + 24 * 60) % (24 * 60);
    const next = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
    setText(next);
    onChange(next);
  };

  return (
    <div className="relative block min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <span className="relative block">
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setText(normalizeText(event.target.value))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              moveByFiveMinutes(event.key === "ArrowUp" ? 1 : -1);
            }
          }}
          placeholder="--:--"
          title="4桁入力可（930 → 09:30）。上下キーで5分ずつ変更できます"
          aria-label={`${label}時刻`}
          className={`${inputClass} pr-10 tabular-nums`}
        />
        <FontAwesomeIcon icon={faClock} className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
      </span>
    </div>
  );
}

export default function CourseSettingsPreviewPage() {
  const reduceMotion = useReducedMotion();
  const basicSectionRef = useRef<HTMLElement>(null);
  const operationSectionRef = useRef<HTMLElement>(null);
  const connectorRef = useRef<HTMLDivElement>(null);
  const [courseName, setCourseName] = useState("豊中 Amazon");
  const [summaryTitle, setSummaryTitle] = useState("豊中Amazon");
  const [defaultDrivers, setDefaultDrivers] = useState<number | null>(4);
  const [color, setColor] = useState("#84cc16");
  const [colorOpen, setColorOpen] = useState(false);
  const [usesCycles, setUsesCycles] = useState(true);
  const [cycles, setCycles] = useState<CycleDraft[]>(INITIAL_CYCLES);
  const [saveMessage, setSaveMessage] = useState("開発用プレビュー・保存されません");
  const [connectorLayout, setConnectorLayout] = useState<ConnectorLayout>({
    height: 620,
    sourceY: 310,
    targetYs: [178, 432],
  });
  const [connectorReady, setConnectorReady] = useState(false);
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.32, ease: [0.22, 1, 0.36, 1] as const };

  useLayoutEffect(() => {
    const basicSection = basicSectionRef.current;
    const operationSection = operationSectionRef.current;
    const connector = connectorRef.current;
    if (!basicSection || !operationSection || !connector) return;

    let animationFrame = 0;
    const measure = () => {
      const connectorRect = connector.getBoundingClientRect();
      const basicRect = basicSection.getBoundingClientRect();
      const targets = Array.from(operationSection.querySelectorAll<HTMLElement>("[data-flow-target]"));
      const next: ConnectorLayout = {
        height: Math.max(1, connectorRect.height),
        sourceY: basicRect.top + basicRect.height / 2 - connectorRect.top,
        targetYs: targets.map((target) => {
          const rect = target.getBoundingClientRect();
          return rect.top + rect.height / 2 - connectorRect.top;
        }),
      };
      setConnectorLayout((current) => {
        const unchanged = Math.abs(current.height - next.height) < 0.5
          && Math.abs(current.sourceY - next.sourceY) < 0.5
          && current.targetYs.length === next.targetYs.length
          && current.targetYs.every((value, index) => Math.abs(value - next.targetYs[index]) < 0.5);
        return unchanged ? current : next;
      });
      setConnectorReady(true);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(basicSection);
    observer.observe(operationSection);
    observer.observe(connector);
    measure();

    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [cycles.length, usesCycles]);

  const sourceY = connectorLayout.sourceY;
  const connectorTargets = usesCycles
    ? cycles.map((cycle, index) => ({ id: cycle.id, y: connectorLayout.targetYs[index] ?? sourceY }))
    : [{ id: "standard", y: connectorLayout.targetYs[0] ?? sourceY }];
  const connectorPositionsReady = connectorReady
    && connectorLayout.targetYs.length === connectorTargets.length;
  const spineTop = Math.min(sourceY, ...connectorTargets.map((target) => target.y));
  const spineBottom = Math.max(sourceY, ...connectorTargets.map((target) => target.y));

  const updateCycle = (id: number, patch: Partial<CycleDraft>) => {
    setCycles((current) => current.map((cycle) => cycle.id === id ? { ...cycle, ...patch } : cycle));
  };

  const addCycle = () => {
    setCycles((current) => {
      const id = Math.max(0, ...current.map((cycle) => cycle.id)) + 1;
      return [...current, {
        id,
        label: `C${id}`,
        meetingTime: "",
        arrivalTime: "",
        endTime: "",
        meetingPlace: "",
        maxDrivers: null,
      }];
    });
  };

  const removeCycle = (id: number) => {
    if (cycles.length <= 1) return;
    setCycles((current) => current.filter((cycle) => cycle.id !== id));
  };

  return (
    <main className="min-h-screen bg-slate-200 px-3 py-4 text-slate-800 sm:px-6 sm:py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-white/70 bg-white shadow-2xl shadow-slate-500/20 lg:w-[88vw] xl:w-[72vw]">
        <header className="flex shrink-0 items-center gap-3 px-5 py-4 sm:px-8">
          <Link href="/preview" aria-label="プレビュー一覧へ戻る" className="mr-1 flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-300">
            <FontAwesomeIcon icon={faArrowLeft} className="h-3.5 w-3.5" />
          </Link>
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-2xl text-slate-700">
            <FontAwesomeIcon icon={faAmazon} />
          </div>
          <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: color }} aria-label="選択中のコース色" />
          <div className="min-w-0 flex-1">
            <input
              value={courseName}
              onChange={(event) => setCourseName(event.target.value)}
              aria-label="コース名"
              className="w-full max-w-2xl rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-bold text-slate-900 outline-none transition hover:border-slate-200 focus:border-amber-400 focus:bg-amber-50/40 sm:text-2xl"
            />
            <p className="px-1 text-xs text-slate-500">Amazon</p>
          </div>
          <span className="hidden text-xs text-slate-400 lg:block">統合レイアウト案 1</span>
        </header>

        <nav className="flex shrink-0 gap-1 border-b border-slate-200 px-4 sm:px-8" aria-label="コース編集タブ">
          <button type="button" aria-current="page" className="-mb-px inline-flex items-center gap-2 border-b-2 border-amber-500 px-4 py-3 text-sm font-semibold text-amber-700">
            <FontAwesomeIcon icon={faGear} className="h-3.5 w-3.5" />
            コース設定
          </button>
          <Link href="/preview/course-rate?sample=labels" className="-mb-px inline-flex items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-medium text-slate-500 transition hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-300">
            <FontAwesomeIcon icon={faCoins} className="h-3.5 w-3.5" />
            単価設定
          </Link>
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8 lg:px-10">
          <div className="grid min-h-full grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(270px,0.75fr)_48px_minmax(0,1.45fr)] xl:gap-0">
            <section ref={basicSectionRef} className="rounded-2xl border border-slate-200 bg-slate-50/45 p-5 sm:p-6" aria-labelledby="basic-heading">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <h2 id="basic-heading" className="text-base font-bold text-slate-900">基本情報</h2>
                  <p className="mt-1 text-xs text-slate-400">すべての運行サイクルに共通</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold tracking-wide text-slate-500">コース共通</span>
              </div>

              <div className="space-y-4">
                <SelectField label="キャリア" value="Amazon" />
                <SelectField label="取引先（請求先）" value="株式会社万事屋うっちゃん" />
                <label className="block">
                  <FieldLabel>略記（集計・シフト表示用）</FieldLabel>
                  <input value={summaryTitle} onChange={(event) => setSummaryTitle(event.target.value)} className={inputClass} />
                  <span className="mt-1.5 block text-[11px] text-slate-400">未入力の場合はコース名を表示します。</span>
                </label>

                <div className="border-t border-slate-200 pt-4">
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(150px,0.9fr)] gap-3">
                    <label className="block">
                      <FieldLabel>いつもの1日の人数</FieldLabel>
                      <DigitInput
                        value={defaultDrivers}
                        onValueChange={setDefaultDrivers}
                        allowEmpty
                        placeholder="4"
                        ariaLabel="いつもの1日の人数"
                        className={inputClass}
                      />
                    </label>
                    <div className="relative">
                      <FieldLabel>色</FieldLabel>
                      <button
                        type="button"
                        onClick={() => setColorOpen((open) => !open)}
                        aria-expanded={colorOpen}
                        aria-label="コース色を選択"
                        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-600 transition hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-200"
                      >
                        <span className="h-7 w-7 shrink-0 rounded-md border border-slate-300 shadow-inner" style={{ backgroundColor: color }} />
                        <span className="min-w-0 flex-1 truncate">色を選択</span>
                        <FontAwesomeIcon icon={faPalette} className="h-3 w-3 text-slate-400" />
                      </button>

                      {colorOpen && (
                        <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-60 rounded-xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-300/40">
                          <div className="grid grid-cols-5 gap-2" role="group" aria-label="コース色">
                            <span className="col-span-5 mb-0.5 text-[10px] font-semibold text-slate-400">おすすめの色</span>
                            {RECOMMENDED_COLORS.map((item) => (
                              <button
                                key={item}
                                type="button"
                                onClick={() => { setColor(item); setColorOpen(false); }}
                                aria-label={`色 ${item}`}
                                aria-pressed={color === item}
                                className={`h-7 w-7 rounded-full border-2 transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-300 ${color === item ? "border-slate-900" : "border-transparent"}`}
                                style={{ backgroundColor: item }}
                              />
                            ))}
                          </div>
                          <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-slate-100 pt-3 text-xs font-medium text-slate-600">
                            <input
                              type="color"
                              value={color}
                              onChange={(event) => setColor(event.target.value)}
                              aria-label="好きな色を選択"
                              className="h-8 w-10 cursor-pointer rounded-md border border-slate-200 bg-white p-1"
                            />
                            <span className="min-w-0 flex-1">好きな色を選択</span>
                            <span className="font-mono text-[10px] uppercase text-slate-400">{color}</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div ref={connectorRef} className="relative hidden self-stretch xl:block" aria-hidden="true">
              <span
                data-course-flow-node
                className="absolute -left-1.5 z-10 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white"
                style={{ top: sourceY, opacity: connectorReady ? 1 : 0 }}
              />
              <svg
                viewBox={`0 0 72 ${connectorLayout.height}`}
                className="absolute inset-0 h-full w-full overflow-visible"
                preserveAspectRatio="none"
                style={{ opacity: connectorPositionsReady ? 1 : 0 }}
              >
                <defs>
                  <marker id="course-flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L8,4 L0,8 Z" fill="#cbd5e1" />
                  </marker>
                </defs>
                {connectorPositionsReady && (usesCycles ? (
                  <>
                    <motion.path initial={false} animate={{ d: `M0 ${sourceY} H34` }} transition={motionTransition} fill="none" stroke="#cbd5e1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    <motion.path initial={false} animate={{ d: `M34 ${spineTop} V${spineBottom}` }} transition={motionTransition} fill="none" stroke="#cbd5e1" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                    {connectorTargets.map((target) => (
                      <motion.path
                        key={target.id}
                        initial={{
                          d: `M34 ${target.y} H68`,
                          opacity: reduceMotion ? 1 : 0,
                          pathLength: reduceMotion ? 1 : 0,
                        }}
                        animate={{ d: `M34 ${target.y} H68`, opacity: 1, pathLength: 1 }}
                        transition={motionTransition}
                        fill="none"
                        stroke="#cbd5e1"
                        strokeWidth="2"
                        vectorEffect="non-scaling-stroke"
                        markerEnd="url(#course-flow-arrow)"
                      />
                    ))}
                  </>
                ) : (
                  <motion.path
                    initial={false}
                    animate={{ d: `M0 ${sourceY} H34 V${connectorTargets[0].y} H68` }}
                    transition={motionTransition}
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    markerEnd="url(#course-flow-arrow)"
                  />
                ))}
              </svg>
            </div>

            <section ref={operationSectionRef} className="rounded-2xl border border-slate-200 bg-slate-50/45 p-5 sm:p-6" aria-labelledby="operation-heading">
              <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 id="operation-heading" className="text-base font-bold text-slate-900">運行設定</h2>
                  <p className="mt-1 text-xs text-slate-400">時間と人数を運行単位で設定</p>
                  <p className="mt-1 text-[11px] text-slate-400">時刻は4桁でも入力できます（930 → 09:30）</p>
                </div>
                <div className="grid shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 text-xs" role="radiogroup" aria-label="運用単位">
                  {([
                    [false, "サイクルを使用しない"],
                    [true, "サイクルを使用する"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={String(value)}
                      type="button"
                      role="radio"
                      aria-checked={usesCycles === value}
                      onClick={() => {
                        setUsesCycles(value);
                        if (value && cycles.length === 0) addCycle();
                      }}
                      className={`rounded-md px-3 py-2 font-medium transition focus:outline-none focus:ring-2 focus:ring-amber-200 ${usesCycles === value ? "bg-slate-800 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {usesCycles ? (
                <motion.div layout transition={motionTransition} className="space-y-3">
                  <AnimatePresence initial={false}>
                    {cycles.map((cycle, index) => (
                    <motion.article
                      layout
                      key={cycle.id}
                      data-cycle-card={cycle.id}
                      data-flow-target
                      initial={{ height: reduceMotion ? "auto" : 0, opacity: reduceMotion ? 1 : 0, y: reduceMotion ? 0 : 10 }}
                      animate={{ height: "auto", opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -6 }}
                      transition={motionTransition}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/30"
                    >
                      <div className="p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-bold text-white">C{index + 1}</span>
                        <input
                          value={cycle.label}
                          onChange={(event) => updateCycle(cycle.id, { label: event.target.value })}
                          aria-label={`C${index + 1}の名前`}
                          className={`${inputClass} py-2`}
                        />
                        <button
                          type="button"
                          onClick={() => removeCycle(cycle.id)}
                          disabled={cycles.length <= 1}
                          aria-label={`C${index + 1}を削除`}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                          <FontAwesomeIcon icon={faTrashCan} className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <TimeField label="集合" value={cycle.meetingTime} onChange={(value) => updateCycle(cycle.id, { meetingTime: value })} />
                        <TimeField label="開始" value={cycle.arrivalTime} onChange={(value) => updateCycle(cycle.id, { arrivalTime: value })} />
                        <TimeField label="終了目安" value={cycle.endTime} onChange={(value) => updateCycle(cycle.id, { endTime: value })} />
                      </div>
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_112px] gap-3">
                        <label className="block min-w-0">
                          <FieldLabel>集合場所</FieldLabel>
                          <input value={cycle.meetingPlace} onChange={(event) => updateCycle(cycle.id, { meetingPlace: event.target.value })} placeholder="集合場所" className={inputClass} />
                        </label>
                        <label className="block">
                          <FieldLabel>人数</FieldLabel>
                          <DigitInput
                            value={cycle.maxDrivers}
                            onValueChange={(value) => updateCycle(cycle.id, { maxDrivers: value })}
                            allowEmpty
                            placeholder={defaultDrivers == null ? "人数" : `共通 ${defaultDrivers}`}
                            ariaLabel={`C${index + 1}の人数`}
                            className={inputClass}
                          />
                        </label>
                      </div>
                      </div>
                    </motion.article>
                    ))}
                  </AnimatePresence>

                  <motion.button layout transition={motionTransition} type="button" onClick={addCycle} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white/50 py-3 text-sm font-medium text-slate-600 transition-colors hover:border-slate-400 hover:bg-white focus:outline-none focus:ring-2 focus:ring-amber-200">
                    <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
                    サイクルを追加
                  </motion.button>
                </motion.div>
              ) : (
                <article data-flow-target className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/30">
                  <div className="mb-3 text-xs font-bold text-slate-700">標準運行</div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <TimeField label="集合" value={cycles[0]?.meetingTime ?? ""} onChange={(value) => updateCycle(cycles[0]?.id, { meetingTime: value })} />
                    <TimeField label="開始" value={cycles[0]?.arrivalTime ?? ""} onChange={(value) => updateCycle(cycles[0]?.id, { arrivalTime: value })} />
                    <TimeField label="終了目安" value={cycles[0]?.endTime ?? ""} onChange={(value) => updateCycle(cycles[0]?.id, { endTime: value })} />
                  </div>
                  <div className="mt-3 grid grid-cols-[minmax(0,1fr)_112px] gap-3">
                    <label className="block min-w-0"><FieldLabel>集合場所</FieldLabel><input value={cycles[0]?.meetingPlace ?? ""} onChange={(event) => updateCycle(cycles[0]?.id, { meetingPlace: event.target.value })} placeholder="集合場所" className={inputClass} /></label>
                    <label className="block"><FieldLabel>人数</FieldLabel><DigitInput value={defaultDrivers} onValueChange={setDefaultDrivers} allowEmpty placeholder="人数" ariaLabel="標準運行の人数" className={inputClass} /></label>
                  </div>
                </article>
              )}
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-2">
            <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300">
              <FontAwesomeIcon icon={faArchive} className="h-3.5 w-3.5" />
              アーカイブ
            </button>
            <button type="button" className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200">削除</button>
          </div>
          <div className="flex items-center justify-end gap-4">
            <span className="text-xs text-slate-400" aria-live="polite">{saveMessage}</span>
            <button type="button" onClick={() => setSaveMessage("プレビューのため保存していません")} className="rounded-lg bg-slate-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2">保存して閉じる</button>
          </div>
        </footer>
      </div>
    </main>
  );
}
