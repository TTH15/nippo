// "next/image" の差し替え。最適化なしの <img>。
import type { ImgHTMLAttributes } from "react";

type Props = ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean; fill?: boolean; unoptimized?: boolean; quality?: number };

export default function Image({ priority: _p, fill, unoptimized: _u, quality: _q, style, ...props }: Props) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} alt={props.alt ?? ""} style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", ...style } : style} />;
}
