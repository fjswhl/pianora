# 公开曲谱馆

生产库为 D1 `pianora-catalog`（绑定 `CATALOG`）。曲名、作曲家、版本、展示字段和原始文件路径进入 D1。乐谱、PDF、MuseScore 源文件、出处与许可证原件进入 R2 Standard 的 `pianora-assets/catalog/v1/`。账户自己的资产使用独立的私人存储。

## 读取与更新

- 曲谱馆读取 `/api/catalog/composers` 和 `/api/catalog/scores`。曲目默认每页 48 首，作曲家每页 100 位。两个接口均通过返回的 `next` 继续翻页。作品编号、作曲家索引和发布时维护的计数器支持按页查询。
- 每个乐谱版本有独立的稳定曲目 ID。以同一 ID 更新文件保留作品编号。文件 URL 包含原始文件 SHA-256 和格式，相同内容与格式只占一个 R2 对象。旧的 `/presets/…` 按原路径跳转至当前版本。旧哈希保留，可供已打开的页面继续下载。
- LilyPond、MusicXML 和文本附件预先 gzip。浏览器读取解压后的原始内容，照常在本机解析、制谱和推理。PDF、MXL、MuseScore 与 MIDI 保留原始字节。
- 目录的浏览器缓存 60 秒，边缘缓存 5 分钟。带哈希的文件可在浏览器缓存一年。常见小文件也在边缘缓存，大文件直接从 R2 流式返回。边缘缓存按数据中心生效。命中 Worker Cache API 仍计一次 Worker 请求。
- `seed/` 收录此次迁移的原始曲目，可用于空库恢复与 E2E。部署包不包含这些文件。后续曲集可以直接从仓库外的目录导入。

## 发布一个曲集

Node 24，在仓库根目录运行。每个批次提供一份 JSON 清单及文件目录。路径相对于文件目录，在不同曲集前加稳定的目录名。一个乐章的多个版本分别使用独立 ID 与路径，更新原版本复用它们。保留整理来源和授权文本可参考当前种子清单。

示例清单（文件存在于导入目录中）

```json
{
  "scores": [{
    "id": "bach_bwv846_example",
    "composer": "Bach",
    "name": "C 大调前奏曲 BWV 846",
    "file": "collection-a/bwv846.musicxml",
    "scoreType": "MusicXML",
    "subtitle": "钢琴独奏"
  }],
  "attachments": [{"file": "collection-a/LICENSE.txt"}]
}
```

```sh
node scripts/import-catalog.mjs --plan --manifest /data/batch.json --files /data/files
# R2 对象读写令牌和目标账户 ID 通过 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 注入
node scripts/import-catalog.mjs --remote --manifest /data/batch.json --files /data/files --sql-out /tmp/catalog-verified.sql
# 使用拥有目标 D1 写权限的 Wrangler 凭据
npx wrangler d1 migrations apply CATALOG --remote
npx wrangler d1 execute CATALOG --remote --file /tmp/catalog-verified.sql
```

规划会打印批次曲目数、唯一对象数、原始和压缩字节。上传先检查已有对象，只写缺失对象，读回并核对 SHA-256 后才生成 SQL。仅在上传命令成功后使用它本次生成的 SQL。同一批次可重跑，重复曲目通过 ID 更新，未改动的行跳过写入。导入后等目录缓存刷新即可浏览，前端无需重新部署。GitHub Actions 的 **Verify and upload catalog objects** 支持选择种子或已收录的开放曲集，生成经远端校验的 SQL artifact。

首批新增的 [Mutopia 钢琴曲目](collections/mutopia-piano.json) 含 14 首公有领域排版，每首记录作品页、版本来源、制谱者和文件哈希。选取 `mutopia-piano` 可从固定上游版本重新下载原件。也可以在本地运行 `python3 scripts/fetch-mutopia.py /tmp/mutopia`，然后向导入工具传入 `--manifest catalog/collections/mutopia-piano.json --files /tmp/mutopia`。上线后用 `python3 scripts/verify-mutopia.py` 复验编辑器选曲和播放，加 `--dev-origin http://127.0.0.1:5173` 可在本地 Vite 的浏览器引擎中逐首复验 MIDI 与 SVG 排版。

## 免费容量规划

本次 35 首与 5 份附件在 R2 合计 303,516 字节，生产 D1 首次导入后为 73,728 字节，此批记录了 215 行写入。容量规划以未来曲集的实测平均大小为准，尤其要单独计算扫描 PDF、附件和历史版本。

| 账户资源 | 免费额度 | 规划方式 |
| --- | --- | --- |
| R2 Standard | 10 GB-month，每月 100 万次 A 类、1,000 万次 B 类操作，免公网流出费 | 假设扣除全账户其他对象与保留量后，曲谱可用 8 GB。每份 25 KB 可放约 32 万份，100 KB 约 8 万份，1 MB 约 8 千份。按十进制字节计。 |
| D1 | 每日读 500 万行、写 10 万行，全账户 5 GB，单库 500 MB | 以当前字段和索引，在本机 SQLite 复制 1 万条同结构记录，文件约增长 6.21 MB。长标题、版本和附件会改变结果。批量导入先试 1,000 首，观察 D1 返回的实际行写入和库大小，再按天分批。 |
| Workers Free | 每日 10 万请求，每次 10 ms CPU | 新访客打开曲谱馆通常请求两次目录，再下载一份谱面约为三次曲库请求。每天一万次这样的访问约用三万次，账户、分享、音源和其他 Worker 流量另计。 |

上传前用 Cloudflare 面板查看账户当月 R2 总量和操作数、当天 Workers 和 D1 用量。R2 的免费额度是账户总量，可能产生超额费用。建议曲库单库达到 400 MB 时再按集合拆 D1；若先接近 Worker 请求额度，可把公开乐谱迁到独立公开 R2 桶并绑定缓存域名，让文件下载绕开 Worker。已上线设计使用现有桶的专用前缀。大规模导入前先用样本实测，不自动清除历史版本。

官方额度见 [R2 计价](https://developers.cloudflare.com/r2/pricing/)、[D1 计价](https://developers.cloudflare.com/d1/platform/pricing/)、[D1 上限](https://developers.cloudflare.com/d1/platform/limits/) 和 [Workers 上限](https://developers.cloudflare.com/workers/platform/limits/)。

## 本地开发和复验

Vite 默认代理公开曲库请求到生产。可设置 `PIANORA_CATALOG_ORIGIN=http://127.0.0.1:8797` 指向本地 Worker。以下命令使用独立的本地持久化目录。

```sh
npm ci
npm run build
npx wrangler d1 migrations apply CATALOG --local --persist-to /tmp/pianora-catalog
node scripts/import-catalog.mjs --local --persist-to /tmp/pianora-catalog --sql-out /tmp/catalog-local.sql
npx wrangler d1 execute CATALOG --local --persist-to /tmp/pianora-catalog --file /tmp/catalog-local.sql
npx wrangler dev --local --port 8797 --persist-to /tmp/pianora-catalog
# 另一终端，安装 Python Playwright 和 Chrome 后
python3 scripts/verify-catalog.py http://127.0.0.1:8797 --output artifacts/catalog.json
```

报告记录逐文件哈希、目录计数、分页及浏览器编辑器验证结果。首次发布后亦可用相同命令将 URL 换成生产域名进行复验。
