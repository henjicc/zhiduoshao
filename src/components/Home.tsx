import { ArrowUp, CircleAlert, ImagePlus, Settings } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { IN_APP } from "../core/http.ts";
import { defaultImageQuestion } from "../lib/image.ts";
import { morphToCard, swapScreen } from "../lib/transition.ts";
import { AttachmentStrip, hasFiles, useAttachments } from "./Attachments.tsx";
import { actions, useGraph } from "../store/graph.ts";
import { isConfigured, MOCK_MODE, settingsActions, useSettings } from "../settings/store.ts";
import { SearchToggle } from "./common.tsx";
import { PrefsMenu } from "./PrefsMenu.tsx";
import { HistoryButton, RecentList } from "./History.tsx";
import { useHistory } from "../history/store.ts";
import { drag, WindowControls } from "./TitleBar.tsx";
import { Wordmark } from "./Wordmark.tsx";
import { PlumMark, usePetals } from "./Plum.tsx";
import "../styles/home.css";

export function Home() {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const mark = useRef<SVGSVGElement>(null);
  const att = useAttachments();
  const [drop, setDrop] = useState(false);
  const search = useGraph((s) => s.search);
  const ready = useSettings((s) => isConfigured(s, search));
  const loaded = useHistory((s) => s.loaded);
  // 没有历史时整体上下居中；删光记录（或撤销后又有了）时用页面过渡平滑地挪过去，不用刷新
  const hasItems = useHistory((s) => s.items.length > 0);
  const [empty, setEmpty] = useState<boolean | null>(() => (loaded ? !hasItems : null));
  useEffect(() => {
    if (!loaded) return;
    if (empty === null) setEmpty(!hasItems);
    else if (empty === hasItems) swapScreen(() => setEmpty(!hasItems));
  }, [loaded, hasItems, empty]);

  useEffect(() => { if (empty !== null) ref.current?.focus(); }, [empty !== null]);
  const petals = useSettings((s) => s.petals);
  usePetals(mark, empty !== null && petals);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [text]);

  const images = att.ready ?? [];
  const canSend = !!att.ready && (!!text.trim() || images.length > 0);

  const submit = () => {
    if (!canSend) return;
    // 密钥没填全时先打开设置，问题和图片留在输入框里
    if (!ready) return settingsActions.open();
    const q = text.trim() || defaultImageQuestion(images.length);
    const form = ref.current?.closest("form");
    const start = () => actions.start(q, images);
    if (form) void morphToCard(form, start);
    else start();
  };

  const problem =
    !IN_APP && !MOCK_MODE ? "浏览器无法直接调用腾讯接口，请在桌面应用中使用"
    : !ready ? (search ? "使用前请先填写 TokenHub 与元宝搜索的 API Key" : "使用前请先填写 TokenHub API Key")
    : null;

  return (
    <main className={`home${empty ? " is-empty" : ""}${empty === null ? " is-pending" : ""}`}>
      <header className="home-titlebar" {...drag}>
        <HistoryButton />
        <button type="button" className="icon-btn" aria-label="设置" data-replay-id="settings" onClick={settingsActions.open}>
          <Settings size={16} strokeWidth={1.6} />
        </button>
        <WindowControls />
      </header>
      <div className="home-inner">
        <h1 className="wordmark"><PlumMark markRef={mark} /><Wordmark /></h1>
        <form
          className={`ask${drop ? " is-drop" : ""}`}
          onSubmit={(e) => { e.preventDefault(); submit(); }}
          onDragOver={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDrop(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrop(false); }}
          onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); setDrop(false); att.add([...e.dataTransfer.files]); ref.current?.focus(); }}
        >
          <AttachmentStrip items={att.items} onRemove={(id) => { att.remove(id); ref.current?.focus(); }} />
          <label className="visually-hidden" htmlFor="home-input">问题</label>
          <textarea
            id="home-input"
            data-replay-id="ask-input"
            ref={ref}
            rows={1}
            placeholder={att.items.length ? "关于图片想了解什么？" : "想知道什么，或者在纠结什么？"}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (!files.length) return;
              e.preventDefault();
              att.add(files);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="ask-bar">
            <div className="ask-tools">
              <SearchToggle />
              <PrefsMenu />
              <button type="button" className="icon-btn" aria-label="添加图片" disabled={att.full} onClick={() => file.current?.click()}>
                <ImagePlus size={16} strokeWidth={1.6} />
              </button>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden
                onChange={(e) => { att.add([...(e.target.files ?? [])]); e.target.value = ""; ref.current?.focus(); }} />
            </div>
            <button type="submit" className="send" aria-label="提问" data-replay-id="ask-submit" disabled={!canSend}>
              <ArrowUp size={16} strokeWidth={2} />
            </button>
          </div>
        </form>
        {problem && (
          <p className="home-status" role="status">
            <CircleAlert size={14} strokeWidth={1.8} />
            <span>{problem}</span>
            {IN_APP && <button type="button" className="link-btn" onClick={settingsActions.open}>去设置</button>}
          </p>
        )}
        <RecentList />
      </div>
    </main>
  );
}
