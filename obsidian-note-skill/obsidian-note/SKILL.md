---
name: obsidian-note
description: Generate Obsidian-style hierarchical Markdown notes and automatically save them as verified UTF-8 .md files. Use when the user asks for Obsidian notes, layered notes, tree Markdown, architecture or business-logic maps, system/backend/frontend/new-node outlines, or wants loose content converted into nested headings and indented bullet nodes.
---

# Obsidian Note

## Purpose

Convert loose content into a clean Obsidian-friendly Markdown outline that is easy to paste, fold, search, and expand.

Use a tree structure instead of tables. Preserve the user's domain terms. Prefer concise node names over long explanatory sentences.

## Mandatory Save Workflow

Always save the completed note as a UTF-8 Markdown file unless the user explicitly requests response-only output or says not to create a file.

1. Generate the complete Markdown note in memory.
2. Choose the destination:
   - Use the user-specified path or filename when provided.
   - Otherwise save under `<workspace-root>/docs/obsidian/`.
   - Derive a concise filename from the `#` title.
3. Run `scripts/save_markdown.py`:
   - On Windows, write the generated note to a UTF-8 temporary file with the structured file-editing tool, then pass it with `--input-file`.
   - On UTF-8 shells, the note may be passed through standard input.
4. Read the saved file back and verify:
   - The file starts with the expected `#` title.
   - The content contains no Unicode replacement character `�`.
   - Mermaid code fences and tab indentation are preserved.
5. Return the saved absolute path or a clickable file link with the note summary.

The save script creates missing directories, writes atomically, verifies the first heading against `--title`, and adds a numeric suffix instead of overwriting an existing note. Use `--overwrite` only when the user explicitly asks to replace the existing file.

If Python is unavailable, use the environment's structured file-editing tool to write the same content as UTF-8, then perform the same read-back verification.

## Output Rules

- Start with one `#` title that names the system, topic, or document.
- Use `##` for top-level sections such as `后端`, `前端`, `数据`, `渲染`, `价值点`, `新节点`, or scenario names.
- Use `-` bullets for nodes below each section.
- Use real tab indentation for child nodes when practical; otherwise use one consistent indentation level.
- Keep each bullet short: usually 2-12 Chinese characters, or one compact phrase.
- Put implementation details under the relevant parent node, not in prose paragraphs.
- Avoid tables unless the user explicitly requests a table.
- Avoid long paragraphs, marketing language, and broad explanations.
- Do not add conclusions outside the outline unless the user asks for explanation.

## Structuring Workflow

1. Identify the user's main topic and make it the `#` title.
2. Group content into a small number of `##` sections.
3. Convert value points, capabilities, data types, rendering views, risks, and workflows into nested nodes.
4. Put actionable or newly discovered ideas under `## 新节点`.
5. Save the final note using the mandatory save workflow.

## Recommended Section Patterns

For product or system value notes:

```markdown
# 系统

## 后端
- 数据采集
	- 原始数据
	- 事件数据
	- 特征指标
- 数据处理
	- 清洗
	- 标定
	- 异常处理
- 数据存储
- 数据回放
- 数据下载

## 前端
- 接受数据
- 实时渲染
- 报告展示

## 新节点
- 可扩展能力
- 商业价值
- 风险控制
```

For sensor scenario research:

```markdown
# 传感器应用场景

## 心肺复苏
- 训练价值
	- 实时纠错
	- 标准化考核
	- 培训报告
- 采集数据
	- 按压深度
	- 按压频率
	- 完全回弹
- 渲染
	- 频率仪表
	- 深度柱状条
	- 教练大屏

## 新节点
- 数据资产
- 设备兼容
- 合规边界
```

## Quality Checklist

- The outline can be folded in Obsidian.
- The hierarchy is meaningful without extra prose.
- Similar nodes use parallel wording.
- Repeated concepts are merged.
- High-value nodes appear closer to the top.
- Medical or safety claims are framed as training,辅助评估,记录, or风险提醒 unless validated and requested otherwise.
