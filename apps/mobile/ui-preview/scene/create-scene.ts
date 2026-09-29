import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import vehicleData from "./assets/every-da17v.scene.json";
import { previewVehicle, previewTrafficVehicle } from "../vehicle";
import { addVehiclePlates } from "./vehicle-plate";

export type SceneMode = "idle" | "working" | "moving" | "off";
export type SceneStats = { calls: number; triangles: number; geometries: number; textures: number };
export const SCENE_VERSION = "every-da17v-plates-6";
const ROAD_WIDTH = 6.2;
// 前方+Zの左側通行。中央線は道路の原点、車は左車線の中央に置く。
const VEHICLE_LANE_X = ROAD_WIDTH / 4;

// 実アプリとブラウザで共用する、外部通信を持たないシーン。
export function createDrivingScene(mode: SceneMode, dark = false, immersive = false) {
  const scene = new T.Scene();
  const sky = mode === "idle" ? (dark ? "#121C2B" : "#F6F8FB") : dark ? "#17283F" : mode === "working" || mode === "moving" ? "#9FC9EA" : "#E6F1EA";
  scene.background = new T.Color(sky); scene.fog = new T.Fog(sky, 15, 40);
  scene.add(new T.HemisphereLight(dark ? "#9CBEED" : "#FFFFFF", "#758292", dark ? 1.3 : 2.1));
  const light = new T.DirectionalLight(dark ? "#C5DAFF" : "#FFF5E4", dark ? 2 : 2.8);
  light.position.set(-3, 8, 5); scene.add(light);
  const camera = new T.PerspectiveCamera(34, 1, .1, 80);
  camera.position.set(5.0 + VEHICLE_LANE_X, 2.6, 7.3); camera.lookAt(VEHICLE_LANE_X, 1, 0);
  const van = new T.ObjectLoader().parse(vehicleData);
  van.visible = mode !== "off";
  van.position.x = VEHICLE_LANE_X;
  van.traverse(node => {
    if (!(node instanceof T.Mesh)) return;
    const material = node.material as T.MeshStandardMaterial;
    // 窓はミニチュアの塗装面として扱う。灯火のカバーは元の透過を維持する。
    if (material.name === "Glass") {
      material.color.set("#57788D"); material.opacity = 1; material.transparent = false;
      material.depthWrite = true; material.roughness = .38; material.metalness = .12;
    }
    if (material.transparent) { material.depthWrite = false; material.forceSinglePass = true; }
    material.metalness = Math.min(material.metalness, .25);
  });
  scene.add(van);
  const body = van.getObjectByName("body")!;
  const wheels = ["left-front", "right-front", "left-rear", "right-rear"].map(name => van.getObjectByName(`wheel-${name}`)!);
  const staticObjects = new T.Group(); scene.add(staticObjects);
  const ground = new T.Mesh(new T.PlaneGeometry(100, 100), new T.MeshLambertMaterial({ color: dark ? "#354251" : mode === "off" ? "#BCD2B7" : "#B8C9CE" }));
  ground.name = "ground"; ground.rotation.x = -Math.PI / 2; ground.position.y = -.015; staticObjects.add(ground);
  const road = new T.Mesh(new T.PlaneGeometry(ROAD_WIDTH, 100), new T.MeshLambertMaterial({ color: dark ? "#283548" : "#94A8BA" }));
  road.name = "road"; road.rotation.x = -Math.PI / 2; staticObjects.add(road);
  if (mode === "off") {
    const path = new T.Mesh(new T.PlaneGeometry(1.95, 100), new T.MeshLambertMaterial({ color: dark ? "#667078" : "#D9D6C8" }));
    path.name = "park-path"; path.rotation.x = -Math.PI / 2; path.position.y = .002; staticObjects.add(path);
  }
  // 半透明の楕円を重ねた接地影。影マップは使わない。
  const shadowGeometry = new T.CircleGeometry(1, 24);
  const shadowMaterial = new T.MeshBasicMaterial({ color: "#152236", transparent: true, opacity: .12, depthWrite: false });
  const shadow = new T.InstancedMesh(shadowGeometry, shadowMaterial, 3);
  shadow.position.x = VEHICLE_LANE_X;
  for (let i = 0; i < 3; i++) {
    const transform = new T.Object3D(); transform.rotation.x = -Math.PI / 2;
    transform.scale.set(.85 + i * .08, 1.48 + i * .10, 1); transform.position.y = .012 + i * .002; transform.updateMatrix(); shadow.setMatrixAt(i, transform.matrix);
  }
  shadow.visible = mode !== "off"; scene.add(shadow);
  const material = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const transform = new T.Object3D();
  function piece(geometry: T.BufferGeometry, color: string, position = [0, 0, 0], scale = [1, 1, 1]) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry.clone(); geometry.dispose();
    for (const key of Object.keys(g.attributes)) if (!["position", "normal"].includes(key)) g.deleteAttribute(key);
    g.scale(scale[0], scale[1], scale[2]); g.translate(position[0], position[1], position[2]);
    const c = new T.Color(color), colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b; }
    g.setAttribute("color", new T.BufferAttribute(colors, 3)); return g;
  }
  const box = (color: string, p: number[], s: number[]) => piece(new T.BoxGeometry(), color, p, s);
  function join(parts: T.BufferGeometry[]) { const g = mergeGeometries(parts)!; parts.forEach(p => p.dispose()); return g; }
  const traffic = new T.Group(); traffic.name = "oncoming-traffic"; traffic.visible = false;
  // 既存車の外装を頂点色で1meshにまとめる。遠景用なので内装・灯火の透明カバーは省く。
  // ホームの静止表示では追加の車geometryを作らない。
  if (mode === "working" || mode === "moving") {
    van.updateMatrixWorld(true);
    const inverse = van.matrixWorld.clone().invert(), parts: T.BufferGeometry[] = [];
    van.traverse(node => {
      if (!(node instanceof T.Mesh)) return;
      const source = node.material as T.MeshStandardMaterial;
      if (["Cabin Interior", "Seat Cloth", "Headlight Cover"].includes(source.name)) return;
      const color = /^(Body White|Paint )/.test(source.name) ? "#90ADB6" : `#${source.color.getHexString()}`;
      const geometry = node.geometry.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(inverse, node.matrixWorld));
      parts.push(piece(geometry, color));
    });
    const car = new T.Mesh(join(parts), material); car.rotation.y = Math.PI; traffic.add(car);
    addVehiclePlates(car, previewTrafficVehicle);
    const contact = shadow.clone(); contact.position.x = 0; traffic.add(contact);
  }
  scene.add(traffic);
  addVehiclePlates(body, previewVehicle);
  const tree = (pine: boolean) => join([
    piece(new T.CylinderGeometry(.10, .14, .95, 5), "#9D7E64", [0, .45, 0]),
    ...(pine ? [
      piece(new T.ConeGeometry(.66, 1.1, 7), "#559488", [0, 1.12, 0]),
      piece(new T.ConeGeometry(.51, 1.05, 7), "#619F90", [0, 1.63, 0]),
      piece(new T.ConeGeometry(.34, .9, 7), "#7BAE9B", [0, 2.06, 0]),
    ] : [
      piece(new T.IcosahedronGeometry(.62, 0), "#7BA898", [-.28, 1.36, .05], [1, 1.1, 1]),
      piece(new T.IcosahedronGeometry(.58, 0), "#6E9C8D", [.32, 1.57, -.06], [1, 1.2, 1]),
      piece(new T.IcosahedronGeometry(.57, 0), "#91B5A0", [-.06, 1.99, 0], [1, 1.05, 1]),
    ]),
  ]);
  const building = (height: number, color: string, roof: boolean) => join([
    box(color, [0, height / 2, 0], [1.7, height, 1.6]),
    box("#E5E8E4", [0, height + .04, 0], [1.82, .12, 1.72]),
    ...(roof ? [box("#B6C6D0", [.3, height + .3, -.2], [.65, .5, .6])] : []),
    // 大きな窓と入口だけ足す。頂点色へ結合し、背景の描画回数は増やさない。
    box("#819DAA", [0, .45, .808], [.46, .9, .02]),
    ...Array.from({ length: Math.floor((height - .6) / 1.05) }, (_, floor) =>
      [-.44, .44].flatMap(offset => [
        box("#96B1BD", [offset, 1.42 + floor * 1.05, .808], [.46, .55, .02]),
        box("#96B1BD", [.858, 1.42 + floor * 1.05, offset], [.02, .55, .46]),
        box("#96B1BD", [-.858, 1.42 + floor * 1.05, offset], [.02, .55, .46]),
      ])).flat(),
  ]);
  const cloud = (variant: number) => join([
    piece(new T.IcosahedronGeometry(1, 0), "#F8FAF5", [0, 0, 0], [1.0, .36, .5]),
    piece(new T.IcosahedronGeometry(.65, 0), "#F8FAF5", [.1, .28 + variant * .06, 0], [.9, .8, .85]),
    piece(new T.IcosahedronGeometry(.55, 0), "#EFF3F2", [-.6, .08, 0], [1, .7, 1]),
  ]);
  type Prop = { mesh: T.InstancedMesh; positions: number[][]; speed: number };
  const props: Prop[] = [];
  function instances(name: string, geometry: T.BufferGeometry, positions: number[][], speed = 1) {
    const mesh = new T.InstancedMesh(geometry, material, positions.length); mesh.name = name;
    // 描画範囲は固定の小さな舞台。移動後の古いbounding sphereによる消失を避ける。
    mesh.frustumCulled = false; scene.add(mesh); props.push({ mesh, positions, speed });
  }
  // 車とカメラの移動分、手前側の背景にも余白を確保して車体への重なりを避ける。
  const roadside = (positions: number[][]) => positions.map(([x, y, z]) => [x > 0 && mode !== "off" ? x + VEHICLE_LANE_X : x, y, z]);
  instances("tree-round", tree(false), roadside(mode === "off" ? [[-2.65, 0, .8], [2.65, 0, -3.8], [-3.5, 0, -9]] : [[-3.8, 0, 1], [4, 0, -8], [-4, 0, -17]]));
  instances("tree-pine", tree(true), roadside(mode === "off" ? [] : [[4.1, 0, 3], [-3.8, 0, -7], [4, 0, -17]]));
  if (mode !== "off") {
    instances("building-low", building(2.8, "#CDD9DF", false), roadside([[-6, 0, -4], [6, 0, -14]]));
    instances("building-tall", building(5.2, "#B5C7D6", true), roadside([[-5.8, 0, -14], [6, 0, -4]]));
    instances("building-mid", building(3.5, "#D7D9D5", true), roadside([[-7.4, 0, 6], [7, 0, -22]]));
  } else {
    const shrub = () => join([
      piece(new T.IcosahedronGeometry(.42, 1), "#7EA58A", [-.28, .32, 0], [1.1, .75, 1]),
      piece(new T.IcosahedronGeometry(.45, 1), "#89AF8A", [.25, .38, .08], [1, .9, 1]),
      piece(new T.IcosahedronGeometry(.31, 1), "#A5BF99", [0, .54, -.12]),
    ]);
    instances("park-shrubs", shrub(), [[-1.85, 0, 2], [1.9, 0, 1.5], [-1.75, 0, -2.5], [1.8, 0, -4.2], [-2, 0, -7], [2.2, 0, -8]]);
    const flowers = () => join([
      box("#7C9F7C", [0, .18, 0], [.025, .36, .025]),
      piece(new T.IcosahedronGeometry(.075, 0), "#F6F5DE", [0, .4, 0]),
      piece(new T.IcosahedronGeometry(.07, 0), "#F5E8B3", [.14, .3, .08]),
      piece(new T.IcosahedronGeometry(.06, 0), "#F6F5DE", [-.12, .34, -.05]),
    ]);
    instances("park-flowers", flowers(), [[-1.4, 0, 1.2], [1.5, 0, 2.6], [-1.4, 0, -1], [1.5, 0, -.7], [-2.1, 0, -3.5], [1.5, 0, -5.8]]);
  }
  for (let i = 0; i < 3; i++) instances(`cloud-${i}`, cloud(i), [[-6 + i * 6, 4.3 + (i % 2) * .5, -9 - i * 5]], .10);
  if (mode !== "off") {
    instances("lane-marks", box("#DCE5E9", [0, .006, 0], [.10, .009, 1.4]), Array.from({ length: 13 }, (_, i) => [0, 0, i * 3 - 24]));
    instances("curbs", box("#D5DFDC", [0, .10, 0], [.5, .2, 100]), [[-ROAD_WIDTH / 2 - .25, 0, 0], [ROAD_WIDTH / 2 + .25, 0, 0]], 0);
  }
  const bench = new T.Mesh(join([
    ...[-.19, -.06, .07, .20].map(z => box("#A9845E", [0, .48, z], [1.85, .065, .105])),
    ...[.69, .81, .93].map(y => box("#AE8D68", [0, y, -.25], [1.85, .105, .07])),
    ...[-.7, .7].flatMap(x => [box("#52666B", [x, .26, 0], [.07, .52, .42]), box("#52666B", [x, .72, -.25], [.07, .6, .07])]),
    box("#91714F", [0, .45, -.24], [1.75, .07, .07]),
  ]), material);
  bench.name = "bench"; bench.position.set(0, 0, 0); bench.rotation.y = -.25; bench.visible = mode === "off"; scene.add(bench);
  if (mode === "off") { road.visible = false; camera.position.set(5, 3.2, 7); camera.lookAt(0, .65, 0); }
  let restOrbit = 0;
  let restTouch: { name: string; index: number; elapsed: number } | null = null;
  const setRestOrbit = (angle: number) => {
    if (mode !== "off") return;
    restOrbit = T.MathUtils.clamp(angle, -.35, .35);
    const bearing = Math.atan2(5, 7) + restOrbit;
    camera.position.set(Math.sin(bearing) * Math.hypot(5, 7), 3.2, Math.cos(bearing) * Math.hypot(5, 7));
    camera.lookAt(0, .65, 0);
  };
  const activateRestAt = (x: number, y: number) => {
    if (mode !== "off") return false;
    scene.updateMatrixWorld(true);
    const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2(x, y), camera);
    const hit = ray.intersectObjects([bench, ...props.filter(p => p.mesh.name.startsWith("tree-")).map(p => p.mesh)])[0];
    if (!hit) return false;
    restTouch = { name: hit.object.name, index: hit.instanceId ?? 0, elapsed: 0 };
    return true;
  };
  // 稼働前は割当車両だけを表示する。道路上に駐車している表現にしない。
  if (mode === "idle") {
    staticObjects.visible = false;
    props.forEach(prop => { prop.mesh.visible = false; });
    scene.fog = null;
  }
  let elapsed = 0;
  const update = (delta: number) => {
    elapsed += Math.min(delta, .1);
    if (restTouch) {
      restTouch.elapsed += Math.min(delta, .1);
      if (restTouch.elapsed >= 1.1) restTouch = null;
    }
    bench.position.y = restTouch?.name === "bench" ? .035 * Math.sin(Math.PI * restTouch.elapsed / 1.1) : 0;
    const moving = mode === "working" || mode === "moving";
    const distance = moving ? elapsed * 1.5 : 0;
    // 前方+Zの自車に対して対向車は-Zへ。カメラは自車の前にあるため手前から奥へ抜ける。
    // 一度に1台、22秒間隔。登場/退場位置は画角外と霧の奥に置く。
    const trafficTime = (elapsed - 3) % 22;
    traffic.visible = moving && elapsed >= 3 && trafficTime < 11;
    traffic.position.set(-VEHICLE_LANE_X, 0, 22 - trafficTime * 6);
    // タイヤと影は接地したまま、サスペンションの上の車体だけを小さく弾ませる。
    // delta=0（停止・視差効果を減らす）では姿勢も変えない。
    const phase = moving ? elapsed * Math.PI * 2 * 1.5 : 0;
    body.position.y = .018 * (1 - Math.cos(phase));
    body.rotation.set(.006 * Math.sin(phase), 0, .004 * Math.sin(phase / 2));
    wheels.forEach(w => { w.rotation.x = distance / .2685; });
    for (const p of props) {
      p.positions.forEach(([x, y, z], index) => {
        transform.position.set(x, y, p.speed === 0 ? z : ((z - distance * p.speed + 24) % 39 + 39) % 39 - 24);
        transform.rotation.set(0, 0, restTouch?.name === p.mesh.name && restTouch.index === index ? .08 * Math.sin(Math.PI * restTouch.elapsed / 1.1) : 0);
        transform.scale.set(1, 1, 1); transform.updateMatrix(); p.mesh.setMatrixAt(index, transform.matrix);
      });
      p.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  return {
    scene, camera, update, setRestOrbit, activateRestAt,
    resize(width: number, height: number) {
      camera.aspect = width / Math.max(height, 1);
      // 縦長シートでも車を切らず、上寄りに置いて下の操作領域を空ける。
      // 横並びの狭い車両枠でも、車体の左右を切らずに収める。
      camera.fov = immersive ? T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(34 / 2)) * 1.02 / camera.aspect)) : mode === "idle" ? T.MathUtils.radToDeg(2 * Math.atan(Math.tan(T.MathUtils.degToRad(20 / 2)) * Math.max(1, 1.25 / camera.aspect))) : 34;
      if (immersive) camera.setViewOffset(width, height, 0, height * .13, width, height);
      else camera.clearViewOffset();
      camera.updateProjectionMatrix();
    },
    dispose() {
      const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
      scene.traverse(node => { if (node instanceof T.Mesh) { geometries.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => materials.add(m)); if (node instanceof T.InstancedMesh) node.dispose(); } });
      const textures = new Set<T.Texture>();
      materials.forEach(m => { const map = (m as T.MeshBasicMaterial).map; if (map) textures.add(map); });
      textures.forEach(t => t.dispose());
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); scene.clear();
    },
  };
}
export type DrivingScene = ReturnType<typeof createDrivingScene>;
