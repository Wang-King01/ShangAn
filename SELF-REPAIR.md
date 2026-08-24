# 考公备战台自助恢复

## 最简单的处理方法

1. 双击桌面的“考公备战台（启动或修复）”。
2. 等待浏览器自动打开 `http://127.0.0.1:4137/`。
3. 启动窗口显示 `Ready` 后会自动关闭。

这个入口可以重复点击。网页正常时不会重复启动服务；服务退出时会自动重启；该项目自己的旧进程卡死时会先清理再恢复。

## 如果自动修复失败

启动窗口会停住并显示原因，常见情况如下：

- `Node.js was not found`：安装 Node.js 20 或更高版本，然后再次双击快捷方式。
- `Port 4137 is occupied`：其他程序占用了端口。最简单且安全的处理是重启 Windows，再次双击快捷方式。
- `failed to start`：打开项目 `logs` 目录中的 `last-start-error.txt` 查看具体错误。

不要在任务管理器里批量结束所有 `node.exe`，其他应用也可能使用 Node.js。修复脚本只会结束由本项目记录的服务进程。

## 手动启动

桌面快捷方式丢失时，在项目目录双击 `Open-Gongkao.cmd`，或在 PowerShell 中执行：

```powershell
cd "C:\Users\汪蒋涛\Documents\Codex\2026-07-09\xia\gongkao-manager"
.\Open-Gongkao.cmd
```

可打开 `http://127.0.0.1:4137/api/health` 检查状态。看到 `"ok":true` 表示服务正常。
