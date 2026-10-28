import { getCurrentWindow } from "@tauri-apps/api/window";
import { create } from "zustand";
import { IN_APP } from "../core/http.ts";
import { swapScreen } from "../lib/transition.ts";
import { actions, useGraph } from "../store/graph.ts";
import { onParkedChange, parked, unpark, useParked, type Parked } from "../store/core.ts";
import { toast } from "../store/toast.ts";
import { deleteMap, getMap, listMeta, putMap } from "./db.ts";
import { metaOf, toRecord, worthSaving, type MapMeta } from "./snapshot.ts";

// 历史记录：列表状态、打开与删除，以及当前地图的自动保存。

interface HistoryState {
  items: MapMeta[];
  loaded: boolean;
  /** 「全部历史」面板 */
  open: boolean;
}

export const useHistory = create<HistoryState>(() => ({ items: [], loaded: false, open: false }));
const setH = useHistory.setState;

function upsert(meta: MapMeta) {
  const items = [meta, ...useHistory.getState().items.filter((m) => m.id !== meta.id)];
  setH({ items: items.sort((a, b) => b.updatedAt - a.updatedAt) });
}

export const history = {
  async refresh() {
    try {
      const items = await listMeta();
      setH({ items, loaded: true });
    } catch (e) {
      console.error("[history] 读取失败", e);
      setH({ loaded: true });
    }
  },

  async open(id: string) {
    setH({ open: false });
    // 后台回答中的地图可能还没存过档（第一个回答没完成），直接用内存里的
    const live = parked.get(id);
    const r = live ? toRecord(live.map.id, live.map.createdAt, live.map.updatedAt, live.nodes, live.view, live.opened) : await getMap(id).catch(() => undefined);
    if (!r) {
      toast("这条记录已不存在");
      return void history.refresh();
    }
    // 从画布里打开别的地图：当前地图还有节点在回答时先按设置处理（可能弹出确认）
    actions.leave(() => swapScreen(() => actions.openMap(r)));
  },

  /**
   * 立即从列表和数据库删除，提示里可以撤销：撤销时把删除前读出的整条记录写回。
   * 不再等撤销期过了才删：期间刷新或关窗，延时删除来不及执行，记录又会出现（用户反馈）
   */
  remove(id: string) {
    const meta = useHistory.getState().items.find((m) => m.id === id);
    if (!meta) return;
    setH({ items: useHistory.getState().items.filter((m) => m.id !== id) });
    const removed = getMap(id)
      .then(async (record) => {
        await deleteMap(id);
        return record;
      })
      .catch((e) => {
        console.error("[history] 删除失败", e);
        return undefined;
      });
    toast("已删除一条记录", {
      label: "撤销",
      run: () => void removed.then(async (record) => {
        if (!record) return;
        try {
          await putMap(record, meta);
          upsert(meta);
        } catch (e) {
          console.error("[history] 撤销删除失败", e);
        }
      }),
    });
  },

  openPanel: () => setH({ open: true }),
  closePanel: () => setH({ open: false }),
};

/* ============ 自动保存 ============ */

const SAVE_DELAY = 800;

type Snapshot = Pick<ReturnType<typeof useGraph.getState>, "map" | "nodes" | "view" | "opened">;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: Snapshot | null = null;
/** 上次写入时的节点；节点有变化才更新「最近修改」时间，单纯平移缩放不改变历史排序 */
let lastNodes: Snapshot["nodes"] | null = null;
let failed = false;

async function write(s: Snapshot) {
  if (!s.map || !worthSaving(s.nodes)) return;
  if (s.nodes !== lastNodes) {
    s.map.updatedAt = Date.now();
    lastNodes = s.nodes;
  }
  await persist(s.map, s.nodes, s.view, s.opened);
}

async function persist(map: NonNullable<Snapshot["map"]>, nodes: Snapshot["nodes"], view: Snapshot["view"], opened: Snapshot["opened"]) {
  if (!worthSaving(nodes)) return;
  const record = toRecord(map.id, map.createdAt, map.updatedAt, nodes, view, opened);
  const meta = metaOf(record);
  try {
    await putMap(record, meta);
    failed = false;
    upsert(meta);
  } catch (e) {
    console.error("[history] 保存失败", e);
    if (!failed) toast("历史记录保存失败");
    failed = true;
  }
}

/** 立即写入尚未保存的改动 */
export async function flushSave() {
  if (timer) clearTimeout(timer);
  timer = null;
  const s = pending;
  pending = null;
  if (s) await write(s);
}

/* 后台地图：回答写进来时延迟存档，全部完成时立即存档、移出后台并提示 */
const parkedTimers = new Map<string, ReturnType<typeof setTimeout>>();

function saveParked(p: Parked) {
  clearTimeout(parkedTimers.get(p.map.id));
  parkedTimers.delete(p.map.id);
  p.map.updatedAt = Date.now();
  return persist(p.map, p.nodes, p.view, p.opened);
}

function onParked(mapId: string, done: boolean) {
  const p = parked.get(mapId);
  if (!p) return;
  if (!done) {
    clearTimeout(parkedTimers.get(mapId));
    parkedTimers.set(mapId, setTimeout(() => void saveParked(p), SAVE_DELAY));
    return;
  }
  unpark(mapId);
  // 全部失败、一个回答都没有的地图不存档，也从列表里拿掉（放到后台时临时加进去的）
  if (!worthSaving(p.nodes)) return setH({ items: useHistory.getState().items.filter((m) => m.id !== mapId) });
  void saveParked(p).then(() => {
    const title = metaOf(toRecord(p.map.id, p.map.createdAt, p.map.updatedAt, p.nodes, p.view)).title;
    toast(`「${title.length > 14 ? title.slice(0, 14) + "…" : title}」已在后台回答完成`, { label: "打开", run: () => void history.open(mapId) });
  });
}

let started = false;

export function startAutosave() {
  if (started) return;
  started = true;
  void history.refresh();
  onParkedChange(onParked);
  // 放到后台的地图马上出现在列表里（显示「后台回答中」），不用等第一个回答完成才存档
  useParked.subscribe((s, prev) => {
    for (const id of s.ids) {
      const p = parked.get(id);
      if (p && !prev.ids.includes(id)) upsert(metaOf(toRecord(p.map.id, p.map.createdAt, p.map.updatedAt, p.nodes, p.view)));
    }
  });

  useGraph.subscribe((s, prev) => {
    // 换了地图（回首页、新提问、打开历史）：先把上一张的改动写完
    if (s.map?.id !== prev.map?.id) {
      void flushSave().then(() => { lastNodes = s.nodes; });
      return;
    }
    if (!s.map || (s.nodes === prev.nodes && s.view === prev.view && s.opened === prev.opened)) return;
    pending = { map: s.map, nodes: s.nodes, view: s.view, opened: s.opened };
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void flushSave(), SAVE_DELAY);
  });

  // 关窗前写完未保存的改动；Tauri 会等待这个回调完成再关闭
  // 回调抛错或一直不返回都会让窗口关不掉：吞掉异常，最多等 1.5 秒
  const flushAll = async () => {
    const work = (async () => {
      await flushSave();
      // 后台还没回答完的地图也写一次，下次打开时未完成的节点标为中断、可重试
      await Promise.all([...parked.values()].map(saveParked));
    })();
    try {
      await Promise.race([work, new Promise((r) => setTimeout(r, 1500))]);
    } catch (e) {
      console.error("[history] 关窗前保存失败", e);
    }
  };
  if (IN_APP) void getCurrentWindow().onCloseRequested(flushAll);
  else addEventListener("pagehide", () => void flushAll());
}
