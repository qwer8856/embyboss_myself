# Sakura Emby Boss (Myself)

一个基于 **Pyrogram + FastAPI** 的 Emby 管理 Bot，支持 Telegram 指令面板、WebApp 面板、签到积分、白名单、续期、邀请码、自动任务等能力。

## 功能概览

- Telegram Bot 用户面板与管理员面板
- Emby 账户开通、续期、封禁、白名单
- 签到积分与积分兑换（续期/邀请码）
- WebApp 可视化面板（含 Turnstile 验证）
- 定时任务（到期检查、榜单、备份等）
- API 服务（默认可配置）

## 目录结构

- `main.py`：程序入口
- `bot/`：Bot 主逻辑与模块
- `webapp/`：WebApp 前端静态资源
- `config_example.json`：配置模板
- `docker-compose.yml`：Docker 部署文件
- `Dockerfile`：镜像构建文件

## 快速开始（推荐 Docker）

### 1) 准备配置

```bash
cp config_example.json config.json
```

编辑 `config.json`，至少正确填写：

- `bot_token`
- `owner_api`
- `owner_hash`
- `owner`
- `group`
- `emby_api`
- `emby_url`
- 数据库相关字段（如需要）

### 2) 启动

```bash
docker compose up -d
```

### 3) 查看日志

```bash
docker logs -f embyboss
```

## 本地源码运行

### 1) 安装依赖

```bash
pip install -r requirements.txt
```

### 2) 配置文件

```bash
cp config_example.json config.json
```

### 3) 启动

```bash
python main.py
```

## 关键配置说明

### `group` 支持两种写法

现在支持：

- 数字群 ID：`-1001234567890`
- 群用户名：`"@your_group_username"`

示例：

```json
"group": [
  -1001234567890,
  "@your_group_username"
]
```

### WebApp

- `webapp.status`: 是否启用 WebApp
- `webapp.url`: 面板地址（如 `https://your-domain/tgapp`）
- `webapp.turnstile`: Cloudflare Turnstile 配置

> `docker-compose.yml` 已挂载 `./webapp:/app/webapp`，修改前端后重启容器即可生效。

## 更新说明

### Git 源码部署

可使用 bot 内置更新命令（如已启用）。

### Docker 部署

默认仓库建议：
- `auto_update.git_repo`: `qwer8856/embyboss_myself`
- `auto_update.docker_image`: `gongjuren8856/embyboss_myself:latest`

不接 webhook 时，`/update_bot` 不会更新镜像，请使用：

```bash
docker pull gongjuren8856/embyboss_myself:latest
docker compose up -d --force-recreate embyboss
```

如需让 `/update_bot` 直接触发镜像更新，请在 `config.json` 配置：
- `auto_update.docker_webhook_url`
- `auto_update.docker_webhook_token`

## 常见问题（FAQ）

### 1) `Peer id invalid`

通常是 `group` 配置不正确或当前 Pyrogram 对该标识不可识别。  
请检查 `config.json` 中 `group` 项，优先使用可访问的 `@群用户名` 或正确的 `-100...` 群 ID。

### 2) `AUTH_KEY_UNREGISTERED`

这是 Pyrogram 会话失效。删除 `.session` 后重启并确保 `bot_token / owner_api / owner_hash` 正确。

### 3) WebApp 样式改了但页面没变化

- 确认容器已重启
- 确认静态资源版本号已更新
- Telegram WebApp 彻底关闭后重新打开（避免缓存）

## License

本项目使用仓库内 `LICENSE` 文件所声明的许可证。
