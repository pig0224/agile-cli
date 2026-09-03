---
description: 收集会话中的错误信息，生成标准的问题反馈报告，便于归档与复盘
disable-model-invocation: true
argument-hint: [主题或需求编号]
---

# /agile:feedback — 问题反馈报告

收集**当前会话**中出现的错误/异常/未闭环问题，生成标准反馈报告。

## 执行步骤

1. 回顾本会话上下文，收集：
   - 报错信息（工具报错、命令失败、测试失败）
   - 未按预期工作的行为（描述 + 期望）
   - 中断/跳过的步骤（原因）
2. 若信息不足以定位，向用户简要询问补充（最多一轮），不再追问。
3. 生成报告 `process-docs/<编号>/feedback-<日期>.md`（无编号时放 `process-docs/feedback/`），内容：
   - 标题 / 日期 / 会话主题 / 环境信息（`agile version`、`agile doctor --offline --json` 输出摘要）
   - 问题清单（编号 / 现象 / 期望 / 严重级 P0-P2 / 建议归属：agile-cli / agile-plugin / 业务代码 / 规范问题）
   - 原始错误摘录（代码块）
   - 复现建议
4. 汇报报告路径与问题统计，建议严重问题走 `/agile:fix-bug`。

## 原则

- 只记录事实，不臆测根因；归属不确定标「待分类」。
- 报告全中文。
