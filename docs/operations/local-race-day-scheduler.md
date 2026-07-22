# 本地赛马日周期与 macOS LaunchAgent

这个周期只做一次检查，不在 Node 进程内无限轮询。每次唤醒后，它会读取本地 SQLite 里的 upcoming races，只在未抓取的 T-30、T-10 或 T-3 窗口请求 WIN、PLA、QIN 和 QPL 市场数据。已开赛场次会失败关闭，重试最多三次，数据写入保持幂等。

系统保持 `SHADOW / PAPER_ONLY / RESEARCH_ONLY`：它不登录香港赛马会、不下注、不会把现金模式改成 `PLAY`。只有配置了已冻结且通过验证的本地 scorer adapter 时，周期才会在抓取后写入零现金注额的不可变 shadow lock；默认 CLI 没有配置 scorer 时只会抓取到期快照，并如实报告 `score-not-configured`。

## 当前本地部署状态

生成器对新安装仍保持默认禁用，避免仓库代码自行注册后台任务。本项目的本地主机已于 2026-07-22 在用户明确批准后完成安装和启用；它每十分钟启动一次有限周期，执行完即退出。GitHub Pages 只展示这项汇总状态，不发布主机路径、数据库位置、日志内容或逐场记录。

本地部署把赛程预加载与临场采集分开：每日巡检先复用公开 `refresh` 和 `sync-db` 链路，把已发布的未来排位表同步进获批的私有 SQLite；LaunchAgent 随后只读取这些 `upcoming` 场次，并在到期窗口采集。没有未来本地赛事或排位表尚未发布时，预加载应报告空闲并继续其他研究任务，不伪造场次。

```bash
npm run hkjc:refresh -- --historyDays 1 --futureDays 60
npm run hkjc:sync-db -- --db "$HKJC_PRIVATE_DB"
```

`HKJC_PRIVATE_DB` 只在本地自动化中配置，不进入 Git、GitHub Actions 或 Pages。网络、解析、身份或数据库错误必须保留原有已结算权威数据并失败关闭。

## 先做一次安全演练

在项目根目录执行：

```bash
npm run hkjc:race-day-cycle -- \
  --db hkjc-horse-model/data/hkjc.sqlite \
  --windows T-30,T-10,T-3 \
  --pools WIN,PLA,QIN,QPL \
  --dryRun \
  --output hkjc-horse-model/data/private/latest-race-day-cycle.json
```

`--dryRun` 不请求实时市场、不写快照和锁单。去掉 `--dryRun` 后，仍只有正处于到期且没抓过的窗口才会访问网络。

## 生成待审核的 LaunchAgent

```bash
npm run hkjc:local-scheduler -- \
  --projectPath "$(pwd)" \
  --intervalMinutes 10 \
  --dryRun \
  --output hkjc-horse-model/data/private/com.superlaomiao.hkjc-race-day-cycle.plist

plutil -lint hkjc-horse-model/data/private/com.superlaomiao.hkjc-race-day-cycle.plist
```

最小间隔是 5 分钟。生成的 plist 默认 `Disabled=true`、`RunAtLoad=false`，日志位于 `hkjc-horse-model/data/private/logs/`，不包含 token、密码或 API key。在审核前不要安装。

## 显式安装与启用

先备份已有配置：

```bash
mkdir -p "$HOME/Library/LaunchAgents/backups"
cp "$HOME/Library/LaunchAgents/com.superlaomiao.hkjc-race-day-cycle.plist" \
  "$HOME/Library/LaunchAgents/backups/com.superlaomiao.hkjc-race-day-cycle.$(date +%Y%m%d-%H%M%S).plist" 2>/dev/null || true
```

然后才显式安装：

```bash
npm run hkjc:local-scheduler -- \
  --projectPath "$(pwd)" \
  --intervalMinutes 10 \
  --output hkjc-horse-model/data/private/com.superlaomiao.hkjc-race-day-cycle.plist \
  --install

launchctl enable "gui/$(id -u)/com.superlaomiao.hkjc-race-day-cycle"
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.superlaomiao.hkjc-race-day-cycle.plist"
launchctl kickstart -k "gui/$(id -u)/com.superlaomiao.hkjc-race-day-cycle"
```

安装命令只复制已审核的 plist，不自动执行 `launchctl enable/bootstrap`。这个人工边界是故意保留的。

## 查看状态和日志

```bash
launchctl print "gui/$(id -u)/com.superlaomiao.hkjc-race-day-cycle"
tail -n 100 hkjc-horse-model/data/private/logs/race-day-cycle.log
tail -n 100 hkjc-horse-model/data/private/logs/race-day-cycle-error.log
```

Mac 睡眠、关机或断网时不能抓取。LaunchAgent 醒来后不会补造已错过的赛前快照；这些缺口应由 prospective coverage 报告记录为 missed/offline，不能用赛后数据填充。

## 停用和卸载

```bash
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.superlaomiao.hkjc-race-day-cycle.plist" 2>/dev/null || true
launchctl disable "gui/$(id -u)/com.superlaomiao.hkjc-race-day-cycle"
rm "$HOME/Library/LaunchAgents/com.superlaomiao.hkjc-race-day-cycle.plist"
```

GitHub Actions 和 GitHub Pages 不运行这个本地调度器，也不上传 SQLite、市场快照、模型产物、锁单或日志。

## 生成覆盖率和备份健康报告

锁定候选模型的 freeze date 后，可以在本地执行：

```bash
npm run hkjc:prospective-coverage -- \
  --db hkjc-horse-model/data/hkjc.sqlite \
  --freezeDate 2026-07-22 \
  --backupManifest hkjc-horse-model/data/private/backup-manifest.json \
  --output hkjc-horse-model/data/processed/prospective-coverage.json
```

可选的 `--events` 可读取 race-day cycle 的 `events` 或 `due` 数组，用于区分 offline、collector error、duplicate 和 not-selling。报告不包含本地数据库标签、备份路径、逐场锁单或模型产物。未达到事先声明的数据门槛时，输出必须是 `BLOCKED_DATA / NO_BET`。
