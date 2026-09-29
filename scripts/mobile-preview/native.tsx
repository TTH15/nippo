// 本番RNコンポーネントのDOM表示アダプター。ネイティブOS動作は検証しない。
import React from "react";
export { NativeModal as Modal } from "./NativeModal";
export const Alert = { alert: (title: string, message: string, buttons: { style?: string; onPress?: () => void }[]) => { if (window.confirm(`${title}\n${message}`)) buttons.find(b => b.style === "destructive")?.onPress?.(); } };
export const Platform = { OS: "ios" };
export const useWindowDimensions = () => {
  const [size, setSize] = React.useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  React.useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return { ...size, scale: window.devicePixelRatio || 1, fontScale: 1 };
};
type Props = any;
const css = (style: any = {}) => {
  const { paddingHorizontal, paddingVertical, lineHeight, ...rest } = style;
  return { ...(paddingHorizontal !== undefined ? { paddingLeft: paddingHorizontal, paddingRight: paddingHorizontal } : {}), ...(paddingVertical !== undefined ? { paddingTop: paddingVertical, paddingBottom: paddingVertical } : {}), ...(lineHeight !== undefined ? { lineHeight: typeof lineHeight === "number" ? `${lineHeight}px` : lineHeight } : {}), ...rest };
};
export const View = ({ children, className = "", style, accessibilityLabel, accessibilityRole, testID }: Props) => <div className={`rn-view ${className}`} aria-label={accessibilityLabel} role={accessibilityRole === "image" ? "img" : accessibilityRole} data-testid={testID} style={css(style)}>{children}</div>;
export const Text = ({ children, className, style, accessibilityRole }: Props) => <span className={`rn-text ${className ?? ""}`} role={accessibilityRole} style={css(style)}>{children}</span>;
export const Pressable = ({ children, className, onPress, disabled, accessibilityRole, accessibilityState, accessibilityLabel, style, testID }: Props) => <button className={`rn-button ${className ?? ""}`} style={css(style)} aria-label={accessibilityLabel} data-testid={testID} onClick={onPress} disabled={disabled} role={accessibilityRole} aria-checked={accessibilityState?.checked ?? accessibilityState?.selected}>{children}</button>;
export const TextInput = ({ onChangeText, keyboardType, accessibilityLabel, ...props }: Props) => <input {...props} aria-label={accessibilityLabel} onChange={e => onChangeText?.(e.target.value)} inputMode={keyboardType === "number-pad" ? "numeric" : keyboardType === "phone-pad" ? "tel" : "text"} />;
export const ActivityIndicator = () => <span role="status">確認中…</span>;
export const KeyboardAvoidingView = View;
export const ScrollView = ({ children, contentContainerClassName, contentContainerStyle, style, testID }: Props) => <div data-testid={testID} className={`rn-view ${contentContainerStyle ? "" : "min-h-screen"} ${contentContainerClassName ?? ""}`} style={{ ...css(style), ...css(contentContainerStyle) }}>{children}</div>;
export const Switch = ({ value, onValueChange, accessibilityLabel }: Props) => <input type="checkbox" role="switch" checked={value} aria-label={accessibilityLabel} onChange={e => onValueChange(e.target.checked)} style={{ minWidth: 44, minHeight: 44 }} />;
export const Image = ({ source, style, accessible }: Props) => {
  const src = source.default ?? source;
  if (style?.tintColor) { const { tintColor, ...rest } = style; return <span aria-hidden="true" style={{ ...rest, backgroundColor: tintColor, maskImage: `url("${src}")`, maskSize: "100% 100%", maskRepeat: "no-repeat" }} />; }
  return <img src={src} style={{ ...style, objectFit: "contain" }} alt={accessible === false ? "" : "ハコ虎"} />;
};
