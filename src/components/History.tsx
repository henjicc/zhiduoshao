import { ArrowRight, History as HistoryIcon, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { history, useHistory } from "../history/store.ts";
import { ago, groupOf, matches, type Group, type MapMeta } from "../history/snapshot.ts";
import { useGraph, useParked } from "../store/graph.ts";
import { usePresence } from "./presence.ts";
import { MetaParts } from "./common.tsx";

const RECENT = 5;

/** 把命中的关键词标出来 */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>;
}

interface RowProps { m: MapMeta; query?: string; current?: boolean; active?: boolean; onHover?: () => void; style?: React.CSSProperties }

function Row({ m, query = "", current, active, onHover, style }: RowProps) {
  const running = useParked((s) => s.ids.includes(m.id));
  return (
    <li className={`hist-row${active ? " is-active" : ""}`} style={style} onPointerEnter={onHover}>
      <button type="button" className="hist-open" onClick={() => void history.open(m.id)}>
        <span className="hist-title"><Highlight text={m.title} query={query} /></span>
        <span className="hist-meta">
          {current ? <span className="hist-current">当前</span> : running ? <span className="hist-current"><LoaderCircle className="spin" size={12} strokeWidth={1.8} aria-hidden="true" />后台回答中</span> : <MetaParts items={[`${m.answers} 个回答`, ago(m.updatedAt)]} />}
        </span>
      </button>
      {!current && !running && (
        <button type="button" className="icon-btn hist-del" aria-label={`删除「${m.title}」`} onClick={() => history.remove(m.id)}>
          <Trash2 size={14} strokeWidth={1.6} />
        </button>
      )}
    </li>
  );
}

/** 首页：最近几张地图 */
export function RecentList() {
  const items = useHistory((s) => s.items);
  const loaded = useHistory((s) => s.loaded);
  if (!loaded || !items.length) return null;
  return (
    <section className="recent" aria-labelledby="recent-title">
      <div className="recent-head">
        <h2 id="recent-title" className="section-title">最近</h2>
        <button type="button" className="recent-all" onClick={history.openPanel}>
          全部历史{items.length > RECENT && ` ${items.length}`}
          <ArrowRight size={13} strokeWidth={1.6} />
        </button>
      </div>
      <ol className="hist-list">
        {items.slice(0, RECENT).map((m, i) => <Row key={m.id} m={m} style={{ "--i": i } as React.CSSProperties} />)}
      </ol>
    </section>
  );
}

/** 顶栏入口 */
export function HistoryButton() {
  return (
    <button type="button" className="icon-btn" aria-label="历史记录" onClick={history.openPanel}>
      <HistoryIcon size={16} strokeWidth={1.6} />
    </button>
  );
}

const GROUPS: Group[] = ["今天", "昨天", "近 7 天", "更早"];

export function HistoryPanel() {
  const open = useHistory((s) => s.open);
  const p = usePresence(open);
  return p.mounted ? <Panel closing={p.closing} /> : null;
}

function Panel({ closing }: { closing: boolean }) {
  const items = useHistory((s) => s.items);
  const currentId = useGraph((s) => s.map?.id);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const found = useMemo(() => items.filter((m) => matches(m, query)), [items, query]);
  const groups = useMemo(() => GROUPS.map((g) => ({ g, rows: found.filter((m) => groupOf(m.updatedAt) === g) })).filter((x) => x.rows.length), [found]);
  // 键盘移动按分组后的顺序
  const flat = groups.flatMap((x) => x.rows);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    list.current?.querySelector(".hist-row.is-active")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); return history.closePanel(); }
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (flat.length) setCursor((c) => (c + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length);
    } else if (e.key === "Enter" && flat[cursor]) {
      e.preventDefault();
      void history.open(flat[cursor].id);
    }
  };

  let k = -1;
  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`} onKeyDown={onKey}>
      <div className="dialog-scrim" onClick={history.closePanel} />
      <div className="dialog history" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header className="dialog-head">
          <h2 id="history-title">历史记录</h2>
          <span className="history-count">{items.length ? `${items.length} 张地图` : ""}</span>
          <button type="button" className="icon-btn" aria-label="关闭历史记录" onClick={history.closePanel}>
            <X size={16} strokeWidth={1.6} />
          </button>
        </header>
        <div className="history-search">
          <Search size={15} strokeWidth={1.6} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索问题" aria-label="搜索历史记录" />
          {query && (
            <button type="button" className="icon-btn" aria-label="清空搜索" onClick={() => { setQuery(""); input.current?.focus(); }}>
              <X size={14} strokeWidth={1.6} />
            </button>
          )}
        </div>
        <div className="dialog-body history-body" ref={list}>
          {!items.length ? (
            <p className="history-empty">还没有历史记录</p>
          ) : !flat.length ? (
            <p className="history-empty">没有找到包含「{query.trim()}」的记录</p>
          ) : groups.map(({ g, rows }) => (
            <section key={g} className="history-group">
              <h3 className="section-title">{g}</h3>
              <ol className="hist-list">
                {rows.map((m) => {
                  const i = ++k;
                  return <Row key={m.id} m={m} query={query} current={m.id === currentId} active={i === cursor} onHover={() => setCursor(i)} />;
                })}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
