#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=2.0.0"]
# ///
"""
ハコ虎 Blender MCP サーバー

    Claude Code → このサーバー(MCP/stdio) → [TCP 127.0.0.1:9876] → addon.py → bpy → Blender

Blender 側（addon.py）が立てている TCP ブリッジへ JSON を投げるだけの薄い層。
モデリングの判断はこちら側では行わない。

Blender の起動:
    scripts/blender-mcp/launch.sh          # GUI（既定。目で見ながら作業できる）
    scripts/blender-mcp/launch.sh --bg     # ヘッドレス
"""

import base64
import json
import os
import subprocess
import sys
from typing import Any

# mcp 2.0 で FastMCP は MCPServer に改名された（1.x の mcp.server.fastmcp は無い）
from mcp.server.mcpserver import Image, MCPServer

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

from bridge import BlenderNotRunning, call, run_python as _run_python  # noqa: E402

mcp = MCPServer("blender", instructions="Blender をブリッジ越しに操作する。形の確認は render_preview で必ず目視すること。")


@mcp.tool()
def blender_status() -> str:
    """Blender ブリッジに繋がるか確認し、バージョンと開いているファイルを返す。"""
    try:
        info = call("ping", timeout=15)
    except BlenderNotRunning as exc:
        return f"未接続: {exc}"
    return json.dumps(info, ensure_ascii=False)


@mcp.tool()
def get_scene() -> str:
    """シーンの中身（オブジェクト・寸法・三角形数・マテリアル）を JSON で返す。

    モデリングの前後で必ず確認する。dimensions は実寸(m)。
    """
    return json.dumps(call("scene_info"), ensure_ascii=False, indent=1)


@mcp.tool()
def run_python(code: str) -> str:
    """Blender 内で Python(bpy) を実行する。このツールが本体。

    - `bpy` `mathutils` は注入済み。import 不要
    - 変数 `result` に入れた値が返る（`result = obj.name` のように使う）
    - print の出力も返る
    - 例外は traceback ごと返るので、そのまま読んで直せる
    """
    return _run_python(code)


@mcp.tool()
def render_preview(view: str = "iso", resolution: int = 640, engine: str = "BLENDER_WORKBENCH") -> Image:
    """指定した方向から正射影でレンダリングし、画像を返す。形を目で確かめるために使う。

    view: front / back / left / right / top / iso / iso_back
    engine: BLENDER_WORKBENCH（速い・形の確認向け）/ BLENDER_EEVEE_NEXT（陰影つき）
    """
    out = call("render_preview", {"view": view, "resolution": resolution, "engine": engine}, timeout=180)
    return Image(data=base64.b64decode(out["png_base64"]), format="png")


@mcp.tool()
def export_glb(filepath: str, selected_only: bool = False) -> str:
    """glb を書き出す（Draco 圧縮は使わない。Mapbox の model レイヤーが読めないため）。

    書き出したあと、地図に載せる前に必ず仕上げを通すこと:
        node scripts/prepare-vehicle-glb.mjs <入力> <出力> [全長m] [目標三角形数]
    """
    out = call("export_glb", {"filepath": filepath, "selected_only": selected_only}, timeout=180)
    return f"{out['filepath']} ({out['bytes']:,} bytes)"


@mcp.tool()
def save_file(filepath: str = "") -> str:
    """.blend を保存する。filepath 省略時は開いているファイルへ上書き。"""
    return json.dumps(call("save", {"filepath": filepath} if filepath else {}), ensure_ascii=False)


@mcp.tool()
def open_file(filepath: str = "", empty: bool = False) -> str:
    """.blend を開く。filepath 省略時は初期シーン（empty=True で完全な空）。"""
    params: dict[str, Any] = {"empty": empty}
    if filepath:
        params["filepath"] = filepath
    return json.dumps(call("open", params), ensure_ascii=False)


@mcp.tool()
def launch_blender(background: bool = False) -> str:
    """Blender を起動してブリッジを繋ぐ。すでに繋がっていれば何もしない。"""
    try:
        info = call("ping", timeout=5)
        return f"すでに起動しています: {json.dumps(info, ensure_ascii=False)}"
    except BlenderNotRunning:
        pass
    script = os.path.join(HERE, "launch.sh")
    args = [script, "--bg"] if background else [script]
    subprocess.Popen(args, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return "Blender を起動しました。数秒後に blender_status で確認してください"


if __name__ == "__main__":
    mcp.run()
