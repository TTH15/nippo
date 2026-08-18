#!/usr/bin/env python3
"""
Blender ブリッジのクライアント（標準ライブラリのみ）。

MCP サーバー（server.py）とコマンドラインの共通の足回り。
MCP に依存しないので、Claude Code を再起動していない状況でも
`python3 scripts/blender-mcp/bridge.py ...` でそのまま Blender を触れる。

    python3 bridge.py ping
    python3 bridge.py scene
    python3 bridge.py exec <ファイル.py>
    python3 bridge.py exec -            # 標準入力から
    python3 bridge.py render iso 640 [出力.png]
    python3 bridge.py export out.glb
"""

import json
import os
import socket
import struct
import sys
from typing import Any

HOST = "127.0.0.1"
PORT = 9876


class BlenderNotRunning(RuntimeError):
    pass


def _recv_exactly(sock: socket.socket, count: int) -> bytes | None:
    buf = b""
    while len(buf) < count:
        chunk = sock.recv(count - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def call(command: str, params: dict[str, Any] | None = None, timeout: float = 300) -> Any:
    """Blender へ1往復。長さヘッダ(4byte, ビッグエンディアン)＋JSON 本体。"""
    payload = json.dumps({"command": command, "params": params or {}, "timeout": timeout}).encode()
    try:
        with socket.create_connection((HOST, PORT), timeout=10) as sock:
            sock.settimeout(timeout + 10)
            sock.sendall(struct.pack(">I", len(payload)) + payload)
            header = _recv_exactly(sock, 4)
            if header is None:
                raise BlenderNotRunning("応答の途中で切断されました")
            (length,) = struct.unpack(">I", header)
            body = _recv_exactly(sock, length)
            if body is None:
                raise BlenderNotRunning("応答が途中で切れました")
    except (ConnectionRefusedError, OSError) as exc:
        raise BlenderNotRunning(
            f"Blender に接続できません（{HOST}:{PORT}）。"
            "scripts/blender-mcp/launch.sh で起動してください: " + str(exc)
        ) from exc

    response = json.loads(body.decode("utf-8"))
    if not response.get("ok"):
        raise RuntimeError(response.get("error", "不明なエラー") + "\n" + response.get("traceback", ""))
    return response.get("data")


def run_python(code: str) -> str:
    out = call("run_python", {"code": code})
    parts = []
    if out.get("stdout"):
        parts.append(out["stdout"].rstrip())
    if out.get("result") is not None:
        parts.append(f"result = {out['result']}")
    return "\n".join(parts) if parts else "(出力なし)"


def _main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    cmd, rest = argv[0], argv[1:]
    try:
        if cmd == "ping":
            print(json.dumps(call("ping", timeout=15), ensure_ascii=False))
        elif cmd == "scene":
            print(json.dumps(call("scene_info"), ensure_ascii=False, indent=1))
        elif cmd == "exec":
            src = sys.stdin.read() if (not rest or rest[0] == "-") else open(rest[0], encoding="utf-8").read()
            print(run_python(src))
        elif cmd == "render":
            view = rest[0] if rest else "iso"
            resolution = int(rest[1]) if len(rest) > 1 else 640
            out = rest[2] if len(rest) > 2 else f"/tmp/blender_{view}.png"
            import base64

            data = call("render_preview", {"view": view, "resolution": resolution}, timeout=180)
            with open(out, "wb") as fh:
                fh.write(base64.b64decode(data["png_base64"]))
            print(out)
        elif cmd == "export":
            print(json.dumps(call("export_glb", {"filepath": rest[0]}, timeout=180), ensure_ascii=False))
        elif cmd == "save":
            print(json.dumps(call("save", {"filepath": rest[0]} if rest else {}), ensure_ascii=False))
        else:
            print(f"未知のコマンド: {cmd}")
            print(__doc__)
            return 1
    except (BlenderNotRunning, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
