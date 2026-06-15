# image-vision-mcp

给纯文本大模型（DeepSeek 等）加上「眼睛」—— 通过 MCP Server 桥接视觉 API，让 Claude Code 中的文本模型也能理解图片。

## 解决的问题

DeepSeek、Kimi 等纯文本模型在 Claude Code 中无法看到图片内容 —— 截图里的报错、UI 设计稿、手绘架构图、文档扫描件，模型统统"看不见"。

`image-vision-mcp` 充当中间层：**图片 → 视觉模型分析 → 文本描述**，让文本模型间接获得视觉理解能力。

## 安装

```bash
cd /path/to/image-vision-mcp
npm install
```

## 在 Claude Code 中配置

编辑 `~/.claude/settings.json`（或项目级 `.claude/settings.json`）：

### 方案一：OpenAI（GPT-4o，最通用）

```json
{
  "mcpServers": {
    "image-vision-mcp": {
      "command": "node",
      "args": ["/Users/nsh/code/image-vision-mcp/src/index.js"],
      "env": {
        "VISION_PROVIDER": "openai",
        "VISION_API_KEY": "sk-your-openai-key"
      }
    }
  }
}
```

### 方案二：硅基流动（DeepSeek-VL2，国内免费额度）

```json
{
  "mcpServers": {
    "image-vision-mcp": {
      "command": "node",
      "args": ["/Users/nsh/code/image-vision-mcp/src/index.js"],
      "env": {
        "VISION_PROVIDER": "siliconflow",
        "VISION_API_KEY": "sk-your-siliconflow-key"
      }
    }
  }
}
```

### 方案三：Anthropic（Claude Vision）

```json
{
  "mcpServers": {
    "image-vision-mcp": {
      "command": "node",
      "args": ["/Users/nsh/code/image-vision-mcp/src/index.js"],
      "env": {
        "VISION_PROVIDER": "anthropic",
        "VISION_API_KEY": "sk-ant-your-anthropic-key"
      }
    }
  }
}
```

### 方案四：自定义兼容 OpenAI 的 endpoint

```json
{
  "mcpServers": {
    "image-vision-mcp": {
      "command": "node",
      "args": ["/Users/nsh/code/image-vision-mcp/src/index.js"],
      "env": {
        "VISION_PROVIDER": "custom",
        "VISION_API_KEY": "your-key",
        "VISION_BASE_URL": "https://your-endpoint.com/v1",
        "VISION_MODEL": "your-model-name"
      }
    }
  }
}
```

## 提供的工具

### 1. `analyze_image`
分析并描述图片内容。适合：截图分析、UI 审查、图表理解

```
参数:
  source  - 本地文件路径 / URL / base64
  question - 针对图片的具体问题（可选）
```

### 2. `ocr_extract`
提取图片中的所有文字。适合：截图报错、扫描文档、代码截图

```
参数:
  source   - 本地文件路径 / URL / base64
  language - 语言提示（可选，如 "Chinese"）
```

### 3. `ocr_precise`
带位置信息的结构化 OCR。适合：需要知道文字确切位置的场景

```
参数:
  source - 本地文件路径 / URL / base64
```

## 使用示例

在 Claude Code 中直接说：

```
"看一下 /path/to/error-screenshot.png 这个报错截图，告诉我错误原因"
"分析这个 UI 设计稿 /path/to/design.png 的布局问题"
"帮我把 /path/to/scan.png 里的文字提取出来"
```

模型会自动调用 `analyze_image` 或 `ocr_extract` 工具。

## 支持的图片来源

- 本地文件：`/path/to/image.png`
- 网络 URL：`https://example.com/image.jpg`
- Base64 数据 URI：`data:image/png;base64,iVBOR...`

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `VISION_PROVIDER` | 否 | `openai` | `openai` / `siliconflow` / `anthropic` / `custom` |
| `VISION_API_KEY` | 是 | - | API Key |
| `VISION_MODEL` | 否 | 按 provider 不同 | 模型名称 |
| `VISION_BASE_URL` | 否 | 按 provider 不同 | 自定义 endpoint |
