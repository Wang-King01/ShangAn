# 公务员备考管理系统

面向江苏名校优生、浙江定向选调和中央选调备考的本地网页系统。学习记录只写入本机；百度网盘课程仅保存目录、视频名称和数量等元数据，不下载视频。

## 启动

日常使用可直接双击项目目录中的 `Open-Gongkao.cmd`。它会先检查服务状态，只有 `4137` 未运行时才启动新进程，然后打开浏览器。

```powershell
cd "C:\Users\汪蒋涛\Documents\Codex\2026-07-09\xia\gongkao-manager"
npm run open
```

浏览器打开 `http://127.0.0.1:4137`。服务仅监听本机地址。

首次执行以下命令可安装当前用户的登录自启动项，电脑重启后服务会在后台自动恢复：

```powershell
npm run install:autostart
```

安装命令还会在桌面创建“考公备战台（启动或修复）”。以后网页出现 `ERR_CONNECTION_REFUSED` 时，直接双击该快捷方式即可。详细排查说明见 [SELF-REPAIR.md](SELF-REPAIR.md)。

## 已接入

- 2026-07-17 至 2026-11-06 的逐日 Todo、计时、进度记录和动态调整建议
- 与 Todo 双向关联的月历，完成任务后月历同步划线
- 百度网盘“考公资料-26名师课程”云端索引、按精选视频排课和精确目录直达
- 郭熙、高照、龙飞、花生十三、白鹭的年份选择、跳课清单、公开经验依据和 B 站入口
- 套题复盘、日常做题统计、考试倒计时、成语背诵和每日精读
- 本地 835 份申论答案索引、规则评分、AI 深度批改及联网答案比对
- 图片上传、AI OCR、题型分类和错题归档
- 本机 Codex 与第三方 Anthropic 兼容 API 双通道，可在每个 AI 功能中主动选择

本机 Codex 通道复用当前账号登录，不需要另填 API Key；第三方通道从服务器端 `.env.local` 读取配置，密钥不会进入浏览器响应或学习记录。两种调用均在服务器端执行，页面会显示实际通道、模型、耗时、校验状态和调用时间。本机 Codex 在只读沙箱中串行运行，默认推理强度为 `medium`。

联网答案比对会先检索并读取候选正文，再按题目、关键词、正文覆盖率和来源权威性打分。只有达到阈值的证据会交给模型；证据不足时接口返回“未找到高相关来源”，不会把广告页或一般评论伪装成标准答案。页面会分别展示高相关证据数、正文验证数、权威来源数和平均相关度。

系统会区分“配置完成”“真实文本调用已验证”“联网比对已验证”和“视觉调用已验证”。某个通道登录失效、额度受限或暂不可用时，只禁用该通道并显示恢复信息；另一通道仍可选择。规则快速评分始终可用。

## 数据位置

- 学习记录：`data/db.json`
- 云端课程安全索引：`data/cloud-course-index.json`
- 名师课程取舍规则：`data/course-strategies.json`
- 课程扫描脚本：`scripts/scan-cloud-courses.py`
- 浏览器验收截图：`output/playwright/`
- Codex 运行状态：`data/codex-runtime.json`（仅保存时间和安全错误码，不保存登录凭据）
- 第三方通道运行状态：`data/anthropic-runtime.json`（不保存 API Key）

重新读取百度网盘课程时，可在“名师课程”页点击“重读云端”。也可运行：

```powershell
npm run scan:courses
```

## 验收

服务启动后运行：

```powershell
npm run test:ui
npm run test:ai
```

`test:ui` 检查桌面端、移动端、页面溢出、Todo 与日历联动、课程统计、双通道选择器以及前端控制台错误。`test:ai` 会从真实网页提交深度批改、联网答案比对和图片 OCR，并校验结构化结果、来源相关性、模型溯源与密钥隔离；默认测试当前可用通道，并记录因额度或登录问题而跳过的通道。测试结束会清理带测试标记的申论与错题记录。

严格复验指定通道或功能：

```powershell
$env:AI_E2E_PROVIDERS='anthropic'
$env:AI_E2E_CAPABILITIES='deep,web,ocr'
npm run test:ai

# Codex 额度恢复后单独复验
$env:AI_E2E_PROVIDERS='codex'
$env:AI_E2E_CAPABILITIES='deep,web,ocr'
npm run test:ai
```
