"""
ハコ虎 Blender ブリッジ（アドオン兼スタンドアロンスクリプト）

    Claude Code → MCP サーバー(server.py) → [TCP 127.0.0.1:9876] → このアドオン → bpy → Blender

Blender 内で TCP サーバーを立て、JSON のコマンドを受けて bpy を叩く。

★ bpy はメインスレッド以外から触ると落ちる。受信はワーカースレッド、実行は
  bpy.app.timers で回すメインスレッドのポンプ、という分担にしてある。

使い方は2通り:
  1) GUI に常駐させる: Blender の Preferences → Add-ons → Install from Disk でこのファイルを指定し、
     3Dビューのサイドバー(N) → ハコ虎 タブから起動
  2) CLI から起動する（こちらが既定。自動化しやすい）:
     /Applications/Blender.app/Contents/MacOS/Blender --python scripts/blender-mcp/addon.py
"""

bl_info = {
    "name": "Hakotora MCP Bridge",
    "author": "hakotora",
    "version": (0, 1, 0),
    "blender": (4, 2, 0),
    "location": "View3D > Sidebar > ハコ虎",
    "description": "MCP サーバーからの指示を受けて bpy を実行するブリッジ",
    "category": "Development",
}

import base64
import contextlib
import io
import json
import os
import queue
import socket
import struct
import tempfile
import threading
import traceback

import bpy
import mathutils

HOST = "127.0.0.1"
PORT = 9876

# ── ワーカースレッド → メインスレッドの受け渡し ──────────────────────────

_jobs: "queue.Queue[_Job]" = queue.Queue()
_server: "_BridgeServer | None" = None


class _Job:
    """1リクエスト。ワーカーが積み、メインスレッドが処理して event を立てる。"""

    def __init__(self, payload):
        self.payload = payload
        self.event = threading.Event()
        self.result = None


def _pump():
    """メインスレッドで回るポンプ。bpy を触るのはここだけ。"""
    while True:
        try:
            job = _jobs.get_nowait()
        except queue.Empty:
            break
        try:
            job.result = {"ok": True, "data": _dispatch(job.payload)}
        except Exception as exc:  # noqa: BLE001 - 落とさずに呼び出し元へ返す
            job.result = {
                "ok": False,
                "error": f"{type(exc).__name__}: {exc}",
                "traceback": traceback.format_exc(),
            }
        job.event.set()
    return 0.05  # 秒。次回の呼び出し間隔


# ── コマンド ────────────────────────────────────────────────────────────


def _mesh_stats(obj):
    """評価後（モディファイア適用後）の頂点・面数。素の mesh を見ると実態とズレる。"""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    try:
        mesh = evaluated.to_mesh()
    except RuntimeError:
        return {"vertices": 0, "polygons": 0, "triangles": 0}
    try:
        tris = sum(max(len(p.vertices) - 2, 0) for p in mesh.polygons)
        return {"vertices": len(mesh.vertices), "polygons": len(mesh.polygons), "triangles": tris}
    finally:
        evaluated.to_mesh_clear()


def _cmd_ping(_params):
    return {
        "blender": bpy.app.version_string,
        "file": bpy.data.filepath or None,
        "scene": bpy.context.scene.name,
    }


def _cmd_scene_info(_params):
    objects = []
    total_tris = 0
    for obj in bpy.context.scene.objects:
        entry = {
            "name": obj.name,
            "type": obj.type,
            "visible": obj.visible_get() if obj.name in bpy.context.view_layer.objects else False,
            "location": [round(v, 4) for v in obj.location],
            "dimensions": [round(v, 4) for v in obj.dimensions],
            "parent": obj.parent.name if obj.parent else None,
            "modifiers": [m.type for m in obj.modifiers],
        }
        if obj.type == "MESH":
            stats = _mesh_stats(obj)
            entry.update(stats)
            total_tris += stats["triangles"]
            entry["materials"] = [m.name for m in obj.data.materials if m]
        objects.append(entry)
    return {
        "scene": bpy.context.scene.name,
        "unit_scale": bpy.context.scene.unit_settings.scale_length,
        "objects": objects,
        "total_triangles": total_tris,
        "materials": [m.name for m in bpy.data.materials],
        "selected": [o.name for o in bpy.context.selected_objects],
    }


def _cmd_run_python(params):
    """任意の bpy コードを実行する。`result` に入れた値が返る。"""
    code = params.get("code") or ""
    namespace = {
        "bpy": bpy,
        "mathutils": mathutils,
        "result": None,
        "__name__": "__hakotora_mcp__",
    }
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stdout):
        exec(compile(code, "<mcp>", "exec"), namespace)  # noqa: S102 - これがこのツールの目的
    value = namespace.get("result")
    return {
        "stdout": stdout.getvalue(),
        "result": None if value is None else repr(value),
    }


def _scene_bounds(only=None):
    """対象オブジェクトのワールド空間バウンディングボックス。"""
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type not in {"MESH", "CURVE", "SURFACE", "FONT"}:
            continue
        if only and obj.name not in only:
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], world[i])
                hi[i] = max(hi[i], world[i])
            found = True
    if not found:
        return mathutils.Vector((0, 0, 0)), mathutils.Vector((1, 1, 1))
    return mathutils.Vector(lo), mathutils.Vector(hi)


# 見る方向（対象 → カメラ の向き）。モデリングの確認で使う定番だけ用意する
_VIEW_DIRECTIONS = {
    "front": (0, -1, 0),
    "back": (0, 1, 0),
    "left": (-1, 0, 0),
    "right": (1, 0, 0),
    "top": (0, 0, 1),
    "iso": (1, -1, 0.65),
    "iso_back": (-1, 1, 0.65),
}


def _cmd_render_preview(params):
    """指定方向から正射影でレンダリングして PNG のパスを返す。

    モデリング中の確認用なので、既定は Workbench（速い・形が分かる）。
    """
    view = params.get("view", "iso")
    resolution = int(params.get("resolution", 640))
    engine = params.get("engine", "BLENDER_WORKBENCH")
    only = params.get("only")
    direction = _VIEW_DIRECTIONS.get(view)
    if direction is None:
        raise ValueError(f"未知の視点: {view}（{'/'.join(_VIEW_DIRECTIONS)}）")

    scene = bpy.context.scene
    lo, hi = _scene_bounds(only)
    center = (lo + hi) / 2
    # ★ 最大辺で合わせると斜め視点で対角がはみ出して見切れる。外接球の直径で合わせる
    size = max((hi - lo).length, 0.001)

    cam_data = bpy.data.cameras.get("__mcp_cam") or bpy.data.cameras.new("__mcp_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.1
    cam = bpy.data.objects.get("__mcp_cam")
    if cam is None:
        cam = bpy.data.objects.new("__mcp_cam", cam_data)
        scene.collection.objects.link(cam)
    cam.data = cam_data

    offset = mathutils.Vector(direction).normalized() * (size * 3 + 1)
    cam.location = center + offset
    # -Z 軸をカメラの視線方向とし、そこへ回転を合わせる
    cam.rotation_euler = (-offset).to_track_quat("-Z", "Y").to_euler()

    prev = {
        "camera": scene.camera,
        "engine": scene.render.engine,
        "x": scene.render.resolution_x,
        "y": scene.render.resolution_y,
        "pct": scene.render.resolution_percentage,
        "path": scene.render.filepath,
        "fmt": scene.render.image_settings.file_format,
        "film": scene.render.film_transparent,
    }
    out = os.path.join(tempfile.gettempdir(), f"hakotora_preview_{view}.png")
    try:
        scene.camera = cam
        scene.render.engine = engine
        scene.render.resolution_x = resolution
        scene.render.resolution_y = resolution
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.film_transparent = False
        scene.render.filepath = out
        if engine == "BLENDER_WORKBENCH":
            shading = scene.display.shading
            shading.light = "STUDIO"
            shading.color_type = "MATERIAL"
            shading.show_cavity = True
        bpy.ops.render.render(write_still=True)
    finally:
        scene.camera = prev["camera"]
        scene.render.engine = prev["engine"]
        scene.render.resolution_x = prev["x"]
        scene.render.resolution_y = prev["y"]
        scene.render.resolution_percentage = prev["pct"]
        scene.render.filepath = prev["path"]
        scene.render.image_settings.file_format = prev["fmt"]
        scene.render.film_transparent = prev["film"]

    with open(out, "rb") as fh:
        data = fh.read()
    return {
        "path": out,
        "view": view,
        "bytes": len(data),
        "png_base64": base64.b64encode(data).decode("ascii"),
    }


def _cmd_export_glb(params):
    """glb 書き出し。**Draco は使わない**（Mapbox の model レイヤーが読めない）。"""
    filepath = params.get("filepath")
    if not filepath:
        raise ValueError("filepath は必須")
    filepath = os.path.abspath(os.path.expanduser(filepath))
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    kwargs = dict(
        filepath=filepath,
        export_format="GLB",
        export_draco_mesh_compression_enable=False,  # Mapbox が読めない
        export_apply=True,  # モディファイアを適用して書き出す
        export_yup=True,
        use_selection=bool(params.get("selected_only")),
    )
    bpy.ops.export_scene.gltf(**kwargs)
    return {"filepath": filepath, "bytes": os.path.getsize(filepath)}


def _cmd_save(params):
    filepath = params.get("filepath")
    if filepath:
        filepath = os.path.abspath(os.path.expanduser(filepath))
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=filepath)
    else:
        bpy.ops.wm.save_mainfile()
    return {"filepath": bpy.data.filepath}


def _cmd_open(params):
    filepath = params.get("filepath")
    if filepath:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(os.path.expanduser(filepath)))
    else:
        bpy.ops.wm.read_homefile(use_empty=bool(params.get("empty")))
    return {"filepath": bpy.data.filepath or None}


_COMMANDS = {
    "ping": _cmd_ping,
    "scene_info": _cmd_scene_info,
    "run_python": _cmd_run_python,
    "render_preview": _cmd_render_preview,
    "export_glb": _cmd_export_glb,
    "save": _cmd_save,
    "open": _cmd_open,
}


def _dispatch(payload):
    name = payload.get("command")
    handler = _COMMANDS.get(name)
    if handler is None:
        raise ValueError(f"未知のコマンド: {name}（{'/'.join(_COMMANDS)}）")
    return handler(payload.get("params") or {})


# ── TCP サーバー ────────────────────────────────────────────────────────


def _recv_exactly(conn, count):
    buf = b""
    while len(buf) < count:
        chunk = conn.recv(count - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def _send_frame(conn, obj):
    body = json.dumps(obj).encode("utf-8")
    conn.sendall(struct.pack(">I", len(body)) + body)


class _BridgeServer(threading.Thread):
    """4バイトの長さヘッダ＋JSON 本体、という素朴なフレーミングで話す。"""

    daemon = True

    def __init__(self):
        super().__init__(name="hakotora-mcp-bridge")
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((HOST, PORT))
        self.sock.listen(4)
        self.sock.settimeout(0.5)
        self._stop = threading.Event()

    def stop(self):
        self._stop.set()
        try:
            self.sock.close()
        except OSError:
            pass

    def run(self):
        print(f"[hakotora-mcp] listening on {HOST}:{PORT}")
        while not self._stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except (socket.timeout, TimeoutError):
                continue
            except OSError:
                break
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()
        print("[hakotora-mcp] stopped")

    def _serve(self, conn):
        with conn:
            while not self._stop.is_set():
                header = _recv_exactly(conn, 4)
                if header is None:
                    return
                (length,) = struct.unpack(">I", header)
                body = _recv_exactly(conn, length)
                if body is None:
                    return
                try:
                    payload = json.loads(body.decode("utf-8"))
                except json.JSONDecodeError as exc:
                    _send_frame(conn, {"ok": False, "error": f"不正な JSON: {exc}"})
                    continue
                job = _Job(payload)
                _jobs.put(job)
                # メインスレッドのポンプが処理するまで待つ（レンダリングは長い）
                if not job.event.wait(timeout=float(payload.get("timeout", 300))):
                    _send_frame(conn, {"ok": False, "error": "Blender 側がタイムアウトしました"})
                    continue
                _send_frame(conn, job.result)


def serve_blocking():
    """ヘッドレス（`blender -b`）用。メインスレッドで待ち受け、その場で実行する。

    ★ -b では Blender のイベントループが回らないため `bpy.app.timers` が発火しない。
      GUI 用の「ワーカーで受けてメインスレッドのポンプで実行する」構成がそのままでは動かない。
      背景実行ではこのプロセス自体がメインスレッドなので、受けたその場で bpy を叩けばよい。
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((HOST, PORT))
    sock.listen(4)
    print(f"[hakotora-mcp] listening on {HOST}:{PORT} (background)", flush=True)
    try:
        while True:
            conn, _ = sock.accept()
            with conn:
                while True:
                    header = _recv_exactly(conn, 4)
                    if header is None:
                        break
                    (length,) = struct.unpack(">I", header)
                    body = _recv_exactly(conn, length)
                    if body is None:
                        break
                    try:
                        payload = json.loads(body.decode("utf-8"))
                        result = {"ok": True, "data": _dispatch(payload)}
                    except Exception as exc:  # noqa: BLE001 - 落とさずに返す
                        result = {
                            "ok": False,
                            "error": f"{type(exc).__name__}: {exc}",
                            "traceback": traceback.format_exc(),
                        }
                    _send_frame(conn, result)
    except KeyboardInterrupt:
        pass
    finally:
        sock.close()


def start_bridge():
    global _server
    if _server is not None:
        return False
    _server = _BridgeServer()
    _server.start()
    if not bpy.app.timers.is_registered(_pump):
        bpy.app.timers.register(_pump, persistent=True)
    return True


def stop_bridge():
    global _server
    if _server is None:
        return False
    _server.stop()
    _server = None
    if bpy.app.timers.is_registered(_pump):
        bpy.app.timers.unregister(_pump)
    return True


# ── Blender UI（アドオンとして入れた場合） ──────────────────────────────


class HAKOTORA_OT_start(bpy.types.Operator):
    bl_idname = "hakotora.start_bridge"
    bl_label = "ブリッジを開始"

    def execute(self, context):
        self.report({"INFO"} if start_bridge() else {"WARNING"},
                    f"{HOST}:{PORT}" if _server else "すでに起動しています")
        return {"FINISHED"}


class HAKOTORA_OT_stop(bpy.types.Operator):
    bl_idname = "hakotora.stop_bridge"
    bl_label = "ブリッジを停止"

    def execute(self, context):
        stop_bridge()
        self.report({"INFO"}, "停止しました")
        return {"FINISHED"}


class HAKOTORA_PT_panel(bpy.types.Panel):
    bl_label = "MCP ブリッジ"
    bl_idname = "HAKOTORA_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "ハコ虎"

    def draw(self, context):
        layout = self.layout
        layout.label(text=f"{HOST}:{PORT}")
        if _server is None:
            layout.operator("hakotora.start_bridge", icon="PLAY")
        else:
            layout.label(text="接続待ち受け中", icon="CHECKMARK")
            layout.operator("hakotora.stop_bridge", icon="PAUSE")


_CLASSES = (HAKOTORA_OT_start, HAKOTORA_OT_stop, HAKOTORA_PT_panel)


def register():
    for cls in _CLASSES:
        bpy.utils.register_class(cls)


def unregister():
    stop_bridge()
    for cls in reversed(_CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    # `blender --python addon.py` で起動したときは、そのまま待ち受けを始める
    if bpy.app.background:
        # -b はイベントループが無いので timers が動かない。メインスレッドで待ち受ける
        serve_blocking()
    else:
        try:
            register()
        except Exception:  # noqa: BLE001 - 既に登録済みなら無視
            pass
        start_bridge()
