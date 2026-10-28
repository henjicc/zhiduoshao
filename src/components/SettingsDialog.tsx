import { Check, CircleAlert, ExternalLink, Eye, EyeOff, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { tracedFetch } from "../core/debug.ts";
import { IN_APP, httpFetch } from "../core/http.ts";
import { VISIBLE_MODELS, profiles } from "../core/models.ts";
import { isPlanKey, testTokenHub } from "../core/providers/tokenhub.ts";
import { ProviderError, type ProviderErrorInfo } from "../core/providers/types.ts";
import { testYuanbao } from "../core/providers/yuanbao.ts";
import { usePresence } from "./presence.ts";
import { MemorySection } from "./MemorySection.tsx";
import { MOCK_MODE, PALETTES, settingsActions, THEMES, useSettings, type Settings } from "../settings/store.ts";

const LINKS = {
  llm: "https://console.cloud.tencent.com/tokenhub/apikey",
  search: "https://console.cloud.tencent.com/wsapi/index?tab=apikey",
};

type Check = { state: "idle" } | { state: "testing" } | { state: "ok"; note?: string } | { state: "fail"; message: string; info: ProviderErrorInfo };

export function SettingsDialog() {
  const open = useSettings((s) => s.open);
  const p = usePresence(open);
  return p.mounted ? <Dialog closing={p.closing} /> : null;
}

function Dialog({ closing }: { closing: boolean }) {
  const llmKey = useSettings((s) => s.llmKey);
  const searchKey = useSettings((s) => s.searchKey);
  const model = useSettings((s) => s.model);
  const autoCollapse = useSettings((s) => s.autoCollapse);
  const autoDetail = useSettings((s) => s.autoDetail);
  const openSource = useSettings((s) => s.openSource);
  const onLeave = useSettings((s) => s.onLeave);
  const palette = useSettings((s) => s.palette);
  const theme = useSettings((s) => s.theme);
  const petals = useSettings((s) => s.petals);
  const first = useRef<HTMLInputElement>(null);
  // 每次修改后在标题旁短暂显示「已保存」
  const [savedTick, setSavedTick] = useState(0);
  const update = (patch: Partial<Settings>) => {
    settingsActions.update(patch);
    setSavedTick((t) => t + 1);
  };

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") settingsActions.close(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const planKey = isPlanKey(llmKey);
  const canTest = IN_APP;

  return (
    <div className={`dialog-layer${closing ? " is-closing" : ""}`}>
      <div className="dialog-scrim" onClick={settingsActions.close} />
      <div className="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="dialog-head">
          <h2 id="settings-title">设置</h2>
          <SavedBadge tick={savedTick} />
          <button type="button" className="icon-btn" aria-label="关闭设置" onClick={settingsActions.close}>
            <X size={16} strokeWidth={1.6} />
          </button>
        </header>

        <div className="dialog-body">
          {!IN_APP && (
            <p className="settings-banner" role="status">
              <CircleAlert size={14} strokeWidth={1.8} />
              <span>{MOCK_MODE ? "当前为开发示例模式，回答使用示例数据。" : "浏览器无法直接调用腾讯接口，请在桌面应用中使用。"}</span>
            </p>
          )}

          {/* 宽窗口分两栏：左边是两个密钥，右边是画布与来源；窄窗口叠成一栏 */}
          <div className="settings-cols">
            <div className="settings-col">
            <section className="settings-section">
              <h3>大模型（TokenHub）</h3>
              <KeyField
                id="llm-key"
                label="TokenHub API Key"
                value={llmKey}
                onChange={(v) => update({ llmKey: v })}
                inputRef={first}
                error={planKey ? "这是 Coding Plan / Token Plan 套餐密钥，套餐条款不允许用于应用，请在 TokenHub 创建按量 API Key" : undefined}
                link={LINKS.llm}
                test={canTest && !planKey ? () => testTokenHub({ apiKey: llmKey, models: profiles(model), fetch: tracedFetch(httpFetch, "test-llm") }) : undefined}
              />
              {/* 只有一个可选模型时不显示选择 */}
              {VISIBLE_MODELS.length > 1 && (
                <div className="field">
                  <span className="field-label" id="model-label">模型</span>
                  <div className="segmented" role="radiogroup" aria-labelledby="model-label">
                    {VISIBLE_MODELS.map((m) => (
                      <button key={m.id} type="button" role="radio" aria-checked={model === m.id} onClick={() => model !== m.id && update({ model: m.id })}>
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
  
            <section className="settings-section">
              <h3>元宝搜索</h3>
              <KeyField
                id="search-key"
                label="服务 API Key"
                value={searchKey}
                onChange={(v) => update({ searchKey: v })}
                link={LINKS.search}
                test={canTest ? () => testYuanbao({ apiKey: searchKey, fetch: tracedFetch(httpFetch, "test-search") }) : undefined}
              />
            </section>
            <MemorySection />
            </div>
            <div className="settings-col">
            <section className="settings-section">
              <h3>外观</h3>
              <div className="field">
                <span className="field-label" id="theme-label">明暗</span>
                <div className="segmented" role="radiogroup" aria-labelledby="theme-label">
                  {THEMES.map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={theme === v} onClick={() => theme !== v && update({ theme: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="palette-label">配色</span>
                <div className="palettes" role="radiogroup" aria-labelledby="palette-label">
                  {PALETTES.map((p) => (
                    <button key={p.id} type="button" role="radio" className="palette" aria-checked={palette === p.id} onClick={() => palette !== p.id && update({ palette: p.id })}>
                      <span className="palette-dot" style={{ background: p.swatch }} />
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="petals-label">首页花瓣飘落</span>
                <div className="segmented" role="radiogroup" aria-labelledby="petals-label">
                  {([[true, "开启"], [false, "关闭"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={petals === v} onClick={() => petals !== v && update({ petals: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="settings-section">
              <h3>画布与来源</h3>
              <div className="field">
                <span className="field-label" id="collapse-label">切换节点时，上一个节点的要点</span>
                <div className="segmented" role="radiogroup" aria-labelledby="collapse-label">
                  {([[false, "保持展开"], [true, "自动收起"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={autoCollapse === v} onClick={() => autoCollapse !== v && update({ autoCollapse: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="detail-label">打开详情时生成详解</span>
                <div className="segmented" role="radiogroup" aria-labelledby="detail-label">
                  {([[false, "手动生成"], [true, "自动生成"]] as const).map(([v, label]) => (
                    <button key={label} type="button" role="radio" aria-checked={autoDetail === v} onClick={() => autoDetail !== v && update({ autoDetail: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="open-source-label">点击来源时</span>
                <div className="segmented" role="radiogroup" aria-labelledby="open-source-label">
                  {([["browser", "系统浏览器打开"], ["reader", "侧边栏阅读视图"]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={openSource === v} onClick={() => openSource !== v && update({ openSource: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span className="field-label" id="leave-label">离开还在回答的地图时</span>
                <div className="segmented" role="radiogroup" aria-labelledby="leave-label">
                  {([["background", "后台继续"], ["ask", "每次询问"], ["stop", "终止"]] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={onLeave === v} onClick={() => onLeave !== v && update({ onLeave: v })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SavedBadge({ tick }: { tick: number }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!tick) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), 1400);
    return () => clearTimeout(t);
  }, [tick]);
  return (
    <span className={`saved-badge${on ? " is-on" : ""}`} role="status" aria-live="polite">
      {on && <><Check size={13} strokeWidth={2} />已保存</>}
    </span>
  );
}

function KeyField(props: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  link: string;
  error?: string;
  /** 成功时可返回一句补充说明（如搜索服务版本） */
  test?: () => Promise<string | void>;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const ctrl = useRef(0);

  // 改动密钥后旧的测试结果作废
  useEffect(() => setCheck({ state: "idle" }), [props.value]);

  const runTest = async () => {
    if (!props.test || !props.value.trim()) return;
    const my = ++ctrl.current;
    setCheck({ state: "testing" });
    try {
      const note = await props.test();
      if (my === ctrl.current) setCheck({ state: "ok", note: note || undefined });
    } catch (err) {
      if (my !== ctrl.current) return;
      console.warn("connection test failed", err instanceof ProviderError ? err.detail : err);
      setCheck(err instanceof ProviderError
        ? { state: "fail", message: err.message, info: err.info }
        : { state: "fail", message: "连接失败", info: { hint: String(err) } });
    }
  };

  return (
    <div className="field">
      <label className="field-label" htmlFor={props.id}>{props.label}</label>
      <div className={`key-input${props.error ? " is-invalid" : ""}`}>
        <input
          id={props.id}
          ref={props.inputRef}
          type="text"
          className={visible ? undefined : "is-masked"}
          value={props.value}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={512}
          aria-invalid={!!props.error}
          aria-describedby={props.error || check.state === "fail" ? `${props.id}-msg` : undefined}
          onChange={(e) => props.onChange(e.target.value.replace(/\s+/g, ""))}
        />
        <button type="button" className="icon-btn" aria-label={visible ? "隐藏密钥" : "显示密钥"} onClick={() => setVisible((v) => !v)}>
          {visible ? <EyeOff size={15} strokeWidth={1.6} /> : <Eye size={15} strokeWidth={1.6} />}
        </button>
      </div>
      {props.error && <p className="field-error" id={`${props.id}-msg`}>{props.error}</p>}
      <div className="field-actions">
        {props.test && (
          <button type="button" className="btn btn-sm" onClick={runTest} disabled={!props.value.trim() || check.state === "testing"}>
            {check.state === "testing" ? <LoaderCircle className="spin" size={13} strokeWidth={1.8} /> : null}
            测试连接
          </button>
        )}
        {check.state === "ok" && <span className="field-ok" role="status"><Check size={13} strokeWidth={2} />连接正常{check.note && `，${check.note}`}</span>}
        <a className="field-link" href={props.link} target="_blank" rel="noopener noreferrer">
          前往控制台创建<ExternalLink size={12} strokeWidth={1.6} />
        </a>
      </div>
      {check.state === "fail" && (
        <div className="test-fail" id={`${props.id}-msg`} role="alert">
          <p className="test-fail-title"><CircleAlert size={14} strokeWidth={1.8} />{check.message}</p>
          {check.info.hint && <p className="test-fail-hint">{check.info.hint}</p>}
          {(check.info.code || check.info.requestId) && (
            <p className="test-fail-meta">
              {check.info.code && <span>错误码 {check.info.code}</span>}
              {check.info.requestId && <span>RequestId {check.info.requestId}</span>}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
