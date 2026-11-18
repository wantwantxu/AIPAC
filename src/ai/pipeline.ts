import { config } from "../config.js";

export type AiProcessResult = {
  summary: string;
  rewritten: string;
  title: string;
  tags: string[];
  imageUrl?: string;
};

export type ProcessMode = "news" | "paper" | "repo";

async function chat(messages: { role: string; content: string }[]): Promise<string> {
  if (!config.AI_API_KEY) {
    throw new Error("未配置 AI_API_KEY");
  }
  const res = await fetch(`${config.AI_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.AI_MODEL,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AI 请求失败 ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || "{}";
}

async function generateImage(prompt: string): Promise<string | undefined> {
  if (!config.AI_ENABLE_IMAGE || !config.AI_API_KEY) return undefined;
  const res = await fetch(`${config.AI_BASE_URL.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.AI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: "1024x1024",
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as { data?: { url?: string }[] };
  return data.data?.[0]?.url;
}

function fallbackLocal(title: string, content: string, mode: ProcessMode): AiProcessResult {
  const body = (content || title).slice(0, 800);
  return {
    summary: `【待翻译】${body.slice(0, 100)}${body.length > 100 ? "…" : ""}`,
    rewritten: [
      mode === "paper"
        ? "（未配置 AI_API_KEY，以下为论文摘要原文）"
        : "（未配置 AI_API_KEY，以下为原文摘录）",
      "",
      `原文标题：${title}`,
      "",
      body,
    ].join("\n"),
    title: `[待译] ${title}`.slice(0, 60),
    tags: mode === "paper" ? ["论文", "待翻译"] : ["海外资讯", "待翻译"],
  };
}

export function detectMode(input: {
  title: string;
  content?: string | null;
  url?: string | null;
  rawJson?: string | null;
}): ProcessMode {
  const blob = `${input.url || ""}\n${input.title}\n${input.content || ""}\n${input.rawJson || ""}`;
  if (
    /arxiv\.org/i.test(blob) ||
    /"kind"\s*:\s*"arxiv"/i.test(blob) ||
    /\bAbstract:\b/i.test(input.content || "") ||
    /\bdoi\.org\b/i.test(blob)
  ) {
    return "paper";
  }
  if (
    /github\.com\//i.test(blob) ||
    /"kind"\s*:\s*"github_repo"/i.test(blob) ||
    /--- README ---/i.test(input.content || "")
  ) {
    return "repo";
  }
  return "news";
}

const NEWS_SYSTEM = `你是一名资深科技媒体编辑，负责将海外新闻内容加工成适合中文读者阅读的高质量原创文章。

## 任务流程

### 第一步：理解原文
- 阅读提供的英文（或外文）新闻内容。
- 提取新闻核心事实。
- 判断新闻主题、影响范围、关键人物、公司、技术背景。
- 不要简单逐句翻译，要理解作者真正想表达的信息。

### 第二步：新闻翻译
将内容改写为自然流畅的中文：
1. 保留事实准确性，不改变原意。
2. 专有名词保持准确：公司名保留英文或采用通用中文名称；技术名词第一次出现时使用「中文（英文）」形式。
3. 避免机器翻译腔。
4. 符合中文科技媒体表达习惯。

### 第三步：文章重构
按中文科技媒体风格组织正文（rewritten 字段用 Markdown）：

标题要求：简洁、有吸引力，突出事件核心，不使用夸张标题党。
错误示例：《AI要毁灭人类了！》
正确示例：《AI智能体开始自主执行网络任务，安全风险引发关注》

导语（写入 summary，100-150字）：谁发生了什么、为什么值得关注、对行业有什么影响。

正文结构（写入 rewritten）：
## 一、事件背景
介绍新闻发生时间、涉及公司/机构、事情经过。

## 二、核心内容
总结关键事实、技术细节、数据和案例（仅限原文有的）。

## 三、技术解读
用普通读者能理解的方式解释技术概念。
不要：「大语言模型通过Transformer架构实现上下文概率预测」
改成：「大语言模型本质上是通过大量数据学习语言规律，从而预测下一步最可能出现的信息。」

## 四、行业影响
对行业、用户、未来趋势分别说明影响（基于原文可合理推断，勿夸大）。

## 五、专家视角（可选）
仅当原文确有相关表述时可写；可基于公开信息做谨慎分析，须用「业内普遍认为」「可能意味着」等措辞。
禁止编造专家观点或虚构采访。

### 第四步：质量红线
必须：像专业科技媒体文章而非翻译稿；保留真实性；可补充必要背景知识；对普通读者友好；逻辑清晰。
禁止：编造事实/数据；虚构采访；改变原新闻观点；夸大影响。

若原文偏娱乐、体育、商业八卦而非硬核科技，仍按上述结构写，但技术解读可改为「背景解读」，语气随题材略调，仍保持专业媒体水准。

### 第五步：输出
严格输出 JSON（不要 Markdown 代码块包裹）：
{
  "title": "中文标题，18-40字，不标题党",
  "summary": "导语 100-150字",
  "rewritten": "完整 Markdown 正文，含 ## 一、事件背景 等五段结构，总长约 800-1800字",
  "tags": ["3-8个关键词"],
  "category": "科技|AI|软件|硬件|商业|安全|互联网 中最贴切的一项"
}`;

const PAPER_SYSTEM = `你是「英文学术论文 → 中文解读」助手。输入通常是 arXiv 标题 + Abstract（摘要），不是全文。

要求：
- 忠实于摘要，不编造实验数字/结论
- 术语：首次出现用「中文（English）」
- 面向工程师/研究生读者，清晰专业

严格输出 JSON：
{
  "title": "中文论文解读标题（可含方法名），22-40字",
  "summary": "一句话贡献 + 一句话意义，80-120字",
  "rewritten": "中文 Markdown 正文，建议结构：\\n## 研究背景\\n## 核心方法\\n## 主要结果（摘要中有的才写）\\n## 局限与展望\\n## 一句话评价\\n用 - 列表提炼要点。总长 700-1400字",
  "tags": ["论文", "领域标签…共3-6个"]
}`;

const REPO_SYSTEM = `你是「开源项目 → 中文介绍」编辑。素材是 GitHub 仓库简介 + README。

要求：
- 根据 README 真实内容介绍项目做什么、解决什么问题、适合谁
- 不要编造 README 没有的功能/数据
- 专有名词可保留英文

严格输出 JSON：
{
  "title": "中文项目介绍标题，20-36字",
  "summary": "一句话说明项目用途，60-100字",
  "rewritten": "中文 Markdown：\\n## 项目是什么\\n## 核心能力\\n## 谁适合用\\n## 快速上手要点（若 README 有）\\n## 小结\\n总长 500-1000字",
  "tags": ["开源", "3-5个领域标签"]
}`;

export async function processContent(input: {
  title: string;
  content?: string | null;
  url?: string | null;
  rawJson?: string | null;
  mode?: ProcessMode;
}): Promise<AiProcessResult> {
  const mode = input.mode || detectMode(input);
  const material = [
    `Mode: ${mode}`,
    `Original title: ${input.title}`,
    input.url ? `Source URL: ${input.url}` : "",
    `Original content:\n${(input.content || "").slice(0, 14000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  if (!config.AI_API_KEY) {
    return fallbackLocal(input.title, input.content || "", mode);
  }

  const system =
    mode === "paper" ? PAPER_SYSTEM : mode === "repo" ? REPO_SYSTEM : NEWS_SYSTEM;

  const raw = await chat([
    { role: "system", content: system },
    { role: "user", content: material },
  ]);

  let parsed: Partial<AiProcessResult> & { category?: string } = {};
  try {
    parsed = JSON.parse(raw) as Partial<AiProcessResult> & { category?: string };
  } catch {
    parsed = fallbackLocal(input.title, input.content || "", mode);
  }

  const fb = fallbackLocal(input.title, input.content || "", mode);
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map(String).slice(0, 8)
    : mode === "paper"
      ? ["论文"]
      : mode === "repo"
        ? ["开源"]
        : ["海外资讯"];
  const category = String(parsed.category || "").trim();
  if (category && !tags.includes(category)) tags.unshift(category);

  const result: AiProcessResult = {
    summary: String(parsed.summary || "").trim() || fb.summary,
    rewritten: String(parsed.rewritten || "").trim() || fb.rewritten,
    title: String(parsed.title || "").trim() || fb.title,
    tags,
  };

  try {
    result.imageUrl = await generateImage(
      mode === "paper"
        ? `Minimal academic illustration, research paper concept, theme: ${result.title}, no text`
        : mode === "repo"
          ? `Clean product illustration for open source project, theme: ${result.title}, no text`
          : `Clean flat editorial illustration, tech news mood, theme: ${result.title}, no text`
    );
  } catch {
    // optional
  }

  return result;
}
