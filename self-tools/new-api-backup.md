# 每小时备份并上传

`new-api-backup.sh` 默认备份 `/root/new-api-1` 项目的 MySQL 和部署配置到
`/var/backups/new-api-1`，保留最新 2 份本地备份。设置 `BACKUP_REMOTE` 后启用 SSH 上传。
使用目标机已有账号，不需要创建专用账号。上传包含 `.env` 的配置快照，请使用私有目录保存。

## 一次性配置

1. 两端安装 `rsync`，源服务器还需要 OpenSSH 客户端、Docker Compose、`flock` 和 `sha256sum`。
   Ubuntu/Debian 的 rsync 安装命令为 `sudo apt-get install -y rsync`；CentOS/RHEL 可用 `yum install -y rsync`。
2. 在源服务器以 root 登录，配置该用户到目标机的 SSH 公钥登录。
   以下目标地址仅为示例，请替换为实际可连接的公网地址。

```bash
# 如已存在此密钥，则沿用。
test -f /root/.ssh/id_ed25519 || ssh-keygen -t ed25519 -N '' -f /root/.ssh/id_ed25519
ssh-copy-id -i /root/.ssh/id_ed25519.pub ubuntu@目标服务器IP

# 首次连接应通过可信渠道确认目标机指纹，再接受记录。
# 下面的检查必须不提示输入密码，并输出 SSH_OK。
ssh -o BatchMode=yes -o ConnectTimeout=10 ubuntu@目标服务器IP 'echo SSH_OK; command -v rsync; command -v sha256sum'
```

默认端口 22，其他端口在上面 SSH 命令中添加 `-p 端口`，并在备份时设置 `BACKUP_SSH_PORT`。
如 SSH 超时，需要先解决网络连接；定时任务不会绕过连接问题。

## 手动试跑

将修改后的脚本同步到源服务器的 `/root/new-api-1/self-tools/new-api-backup.sh`。
在源服务器使用 root 执行，替换实际目标地址：

```bash
BACKUP_REMOTE=ubuntu@目标服务器IP \
BACKUP_REMOTE_DIR=/home/ubuntu/new-api-backups \
BACKUP_KEEP_COUNT=24 \
/bin/bash /root/new-api-1/self-tools/new-api-backup.sh
```

远端目录会自动创建，账号必须有写权限。路径应使用仅含英文字母、数字、`_`、`-`、`.`、`/` 的绝对路径。
成功时输出 `Upload completed` 和 `Backup completed`。
在目标服务器查看：

```bash
ls -lt /home/ubuntu/new-api-backups/
```

## 每小时运行

在源服务器以 root 执行 `crontab -e`，保留其他任务，新增：

```cron
0 * * * * PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin BACKUP_REMOTE=ubuntu@目标服务器IP BACKUP_REMOTE_DIR=/home/ubuntu/new-api-backups BACKUP_KEEP_COUNT=24 /bin/bash /root/new-api-1/self-tools/new-api-backup.sh >> /var/log/new-api-1-backup.log 2>&1
```

确认 cron 服务运行，执行 `crontab -l` 检查任务；到下一个整点后查看：

```bash
tail -n 100 /var/log/new-api-1-backup.log
```

## 可配置项与失败行为

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `APP_DIR` | `/root/new-api-1` | Compose 项目目录 |
| `COMPOSE_PROJECT` | `new-api-1` | 明确选择备份项目 |
| `APP_CONTAINER` | `new-api-1-new-api-1` | 仅用于记录应用镜像 |
| `BACKUP_ROOT` | `/var/backups/new-api-1` | 本地备份根目录 |
| `BACKUP_KEEP_COUNT` | `2` | 保留本地成功备份数量 |
| `BACKUP_REMOTE` | 空 | 已有 SSH 账号与主机，或 SSH 配置别名；空表示仅本地备份 |
| `BACKUP_REMOTE_DIR` | 空 | 目标服务器上的绝对路径，启用上传时必填 |
| `BACKUP_SSH_PORT` | `22` | SSH 端口 |

每份备份包含 `database.sql.gz`、`config.tar.gz`、`manifest.txt` 和 `SHA256SUMS`。
脚本显式指定 Compose 项目与配置文件，并持有覆盖备份和上传全过程的锁。
远端先接收到隐藏临时目录，SHA256 校验通过后才改为正式目录。
上传或校验失败会返回非零状态，保留本地备份并跳过本地清理。
下一次任务会生成和上传新备份，不会补传上一次失败的备份；失败的远端隐藏目录可能保留。
远端正式备份不自动清理，需根据容量另行设置保留策略。
日志也不会自动轮转，长期运行可配置系统 logrotate。
