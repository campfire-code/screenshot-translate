// 空状态示意：外文截图（灰条代表外文）→ 本机识别 → 大模型翻译 → 一段外文配一段中文
export function EmptyFlow() {
  return (
    <svg className="st-flow" viewBox="0 0 560 150" role="img" aria-label="一张外文截图，文字在本机识别后交给大模型翻译，变成逐段对照的译文">
      <g>
        <rect x="6" y="8" width="132" height="104" rx="8" className="st-f-card" />
        <rect x="6" y="8" width="132" height="18" rx="8" className="st-f-bar" />
        <circle cx="18" cy="17" r="3" className="st-f-dot" /><circle cx="29" cy="17" r="3" className="st-f-dot" /><circle cx="40" cy="17" r="3" className="st-f-dot" />
        {[[36, 96], [52, 118], [68, 84], [92, 100]].map(([y, w], i) => <rect key={i} x="18" y={y + 4} width={w} height="7" rx="3.5" className={i === 3 ? 'st-f-ln faint' : 'st-f-ln'} />)}
        <text x="72" y="136" textAnchor="middle" className="st-f-cap">外文截图</text>
      </g>
      <g>
        <rect x="140" y="26" width="74" height="22" rx="11" className="st-f-chip" />
        <text x="177" y="41" textAnchor="middle" className="st-f-chip-t">本机识别</text>
        <path d="M157 64 H195" className="st-f-arrow" /><path d="M188 57 L197 64 L188 71" className="st-f-arrow" />
        <text x="177" y="90" textAnchor="middle" className="st-f-cap">图片不上传</text>
      </g>
      <g>
        <rect x="224" y="26" width="86" height="22" rx="11" className="st-f-chip hot" />
        <text x="267" y="41" textAnchor="middle" className="st-f-chip-t hot">大模型翻译</text>
        <path d="M247 64 H285" className="st-f-arrow" /><path d="M278 57 L287 64 L278 71" className="st-f-arrow" />
        <text x="267" y="90" textAnchor="middle" className="st-f-cap">只发文字</text>
      </g>
      <g>
        <rect x="322" y="8" width="232" height="104" rx="8" className="st-f-card" />
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <rect x="334" y={22 + i * 30} width={[110, 130, 90][i]} height="6" rx="3" className="st-f-ln faint" />
            <text x="334" y={44 + i * 30} className="st-f-zh">{['同步设置', '电量低于 20% 时自动暂停', '上次同步：今天 10:42'][i]}</text>
          </g>
        ))}
        <text x="438" y="136" textAnchor="middle" className="st-f-cap">原文译文逐段对照，可单独复制</text>
      </g>
    </svg>
  );
}
