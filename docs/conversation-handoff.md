# “寻找赛马必胜模式”项目交接

## 迁移来源

- 原对话：`寻找赛马必胜模式`
- 原对话 ID：`019eb1a7-fc81-7603-aa3b-ccdaeeedc269`
- 原源码目录：`/Users/shi/Documents/New project/hkjc-local-horse-model`（保留为迁移前恢复副本）
- 当前项目目录：`/Users/shi/Documents/赛马市场预测`
- 完整文本归档：[`docs/conversation-archive.md`](conversation-archive.md)
- 线上网页：<https://superlaomiao.github.io/hkjc-local-horse-model/>
- GitHub 仓库：<https://github.com/SuperLaomiao/hkjc-local-horse-model>

迁移时先导入了原本地仓库的产品提交，再快进到 GitHub `origin/main` 的最新自动数据刷新提交；因此当前项目包含原对话形成的源码历史，以及对话结束后由定时任务产生的最新赛马数据历史。

## 已形成的产品

这是一个面向香港本地赛马的研究与纸上模拟系统，包含：

- HKJC 公开赛程、赛果和 Race Card 数据刷新；
- 马匹能力、近况和比赛条件的概率化建模；
- 公允赔率、最低入场赔率、正期望筛选和 PASS 规则；
- 纸上本金、注码上限、结算、ROI 与命中率记录；
- 桌面与手机版网页、PWA 外壳和 GitHub Pages 部署；
- 显眼的下一场赛事预报、Race Card 状态与建议查看时间；
- 无本地赛事时显示“今日无本地赛”，不会误用上一场的“不下注”结果。

## 重要约束

- 不存在“必胜模式”。当前系统是研究和纸上模拟工具，不是保证盈利的投注系统。
- 模型的重点不是只猜冠军，而是比较模型胜率与市场赔率，寻找可能被低估的候选。
- 即使模型选中的马最终胜出，只要临场赔率低于最低入场线，仍应 PASS；赛果正确不等于下注具有正期望。
- 页面“刷新”只重新读取已发布的 `data/dashboard.json`。GitHub Pages 前端不会直接触发带权限的后台抓取。
- 后台由 `.github/workflows/refresh-hkjc-data.yml` 定时更新；比赛窗口内约每 10 分钟刷新，也支持 Actions 手动执行。
- HKJC 尚未发布下一场 Race Card 时，不会生成该场赛前预测。

## 当前源码结构

- `index.html`、`styles.css`、`app.js`：静态仪表盘与交互。
- `data/dashboard.json`：当前发布数据。
- `hkjc-horse-model/src/`：抓取、解析、建模和 CLI。
- `hkjc-horse-model/paper-simulations/`：纸上模拟记录。
- `.github/workflows/refresh-hkjc-data.yml`：定时数据更新与发布流程。
- `README.md`：运行方式、边界和页面行为。

## 继续开发时的默认原则

1. 先保持纸上模拟，不把页面包装成“稳赢”产品。
2. 先验证数据是否为当日、Race Card 是否已发布，再解释为什么没有方案。
3. 以赔率价值和长期 ROI 为主要指标，不用单场输赢评价模型。
4. 修改后至少检查 JavaScript 语法、CLI 帮助/运行路径、桌面和手机首屏，以及线上数据刷新状态。
5. 当前项目 `/Users/shi/Documents/赛马市场预测` 是后续工作的主目录；原源码目录只作为迁移恢复副本。
