# WeiqiStats WebUI

围棋赛事公开查询界面，包含赛事签表、棋手档案、交锋、等级分和棋谱查看。

部署时将 `web/` 作为站点静态根目录，并在同一域名下将 `/api/v1/` 转发给 Go Stats 公开只读 API。首页为 `index.html`。
