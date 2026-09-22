# maid-atelier · 深海女仆工坊

DeepSeek Harness Web GUI 的深海女仆工坊皮肤：双女仆背景、深海蓝蕾丝界面与 Q 版侧栏。纯展示层客户端插件——`apply()` 设置 `data-dsh-maid-atelier-wj` 作用域、按亮/暗主题切换宫殿背景、以独立透明层挂载双女仆角色、装饰可折叠侧栏,并为加载/思考/工具运行状态预留稳定动画钩子。effect 销毁器还原全部 CSS/DOM 写入;不注入服务、不发出 Cordis 事件、不触达模型请求。

## 特性

- 双女仆工坊场景对话背景(亮/暗自动切换)
- 深海蓝、陶瓷白、长春花蓝、柔金构成的可热切换 UI 覆盖层
- Q 版侧栏角色与视口装饰、favicon
- 启动插件加载失败时，默认以左右独立的双女仆立绘装饰原生错误报告，支持窄屏重排，遵循现有立绘显示与时段设置。此效果依赖皮肤已成功执行；皮肤自身或内核尚未加载时保留原生页面。
- 双女仆与宫殿背景整层挂在**对话区(centerCol)内部**:随聊天区域尺寸自适应(右/下工作台推开聊天区时背景与女仆同步收缩,不再固定于视口),左女仆贴聊天区左下、右女仆贴右下,均位于聊天记录与输入器之下;聊天态与着陆页按比例切换构图
- 素材内嵌于 client bundle(数据 URI),激活不依赖任何临时文件/远程 URL/资源服务器
- **可选**的会话状态立绘:右女仆在思考/工具运行时、一轮结束、本轮出错各换一张造型;三张造型随包内置(默认开启),也可由使用方通过 `window.__dshMaidAtelierArtwork` 覆盖
- **内置**的左女仆三造型立绘:左女仆有**泳装(分体)**、**冬日洋装(与右女仆同套)**与**浴衣(夏日祭)**三套造型,每套五张、按会话此刻在做什么换姿势与表情(待机/思考/工具执行/回答中/出错);造型在设置里热切换,状态判定只用宿主自身的 DOM 契约,宿主改名时退回待机立绘

## 安装

> 若已安装 `@linxin666/dsh-web-all`（dsh-web），请从 dsh-web 自带的皮肤中心/安装入口安装其适配版 `maid-atelier-wj` 与 `orca-link-wj`，不要执行下面的 standalone 安装命令。两种发行方式的组件与样式契约不同，不能在同一 profile 中叠装。

推荐连同皮肤管理器一起安装。本包**尚未发布到 npm**，用下面的 GitHub 子目录 spec（要求 pnpm ≥ 9，spec 需单引号包裹）：

```sh
dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/skin-manager' && dsh plugin --profile web add 'github:wjingshan/dsh-deep-whale#path:/maid-atelier'
```

PowerShell 版本见仓库 README（用 `;` 分隔命令，spec 需单引号包裹）。首次安装后重启一次 DSH，然后在“设置 → 皮肤管理”中选择“深海女仆工坊”；之后切换走配置热重载。独立子包 link 仅用于本地开发。

加载即生效、卸载即复原(与皮肤中心/dsh-skin 的互斥切换兼容,`wiring.id` 为 `ui-skin-maid-atelier-wj`)。

## 网页与应用图标

标签页在每次加载皮肤模块时从三种表情中随机选择图标，本次加载内保持不变。安装为 Web App 时固定使用托腮图，任务栏图标由浏览器和系统据此生成；已安装或已固定的应用可能需要重新安装或固定才能更新。关闭女仆皮肤时恢复宿主的 favicon 和 manifest 声明。

Windows 快捷方式可下载独立 ICO：[困困](assets/icons/sleepy.ico)、[托腮](assets/icons/delighted.ico)、[认真](assets/icons/determined.ico)。每份包含 16、24、32、48、64、128、256 像素尺寸。

## 会话状态立绘（内置，默认开启）

皮肤可以从宿主自身的 `data-state` 信号判断会话此刻在做什么——思考行与工具行都带这个属性——进而在「思考/工具运行中」「一轮结束」「本轮出错或被中断」三种时机换掉**右女仆**的立绘。三种造型（思考 / 完成·开心 / 出错·泄气）**随包内置**，默认就开着；使用方也可以用自己的数据 URI 覆盖任意一态：

```js
window.__dshMaidAtelierArtwork = {
  thinking: 'data:image/webp;base64,...',
  done:     'data:image/webp;base64,...',
  failed:   'data:image/webp;base64,...',
}
```

在皮肤激活**之前**设好该对象即可覆盖（只覆盖给出的键）。到「设置 → 皮肤管理 → 深海女仆工坊」可以关闭 **按会话状态切换立绘**。思考与出错是即时切换，结束与出错后保持约 4.2 秒再回到原立绘，且只换右女仆那一个节点，销毁时还原原值。**自行提供的图片请先确认授权**，并遵守本皮肤的美术许可边界。

## 左女仆造型（内置，按工作状态更换）

左女仆有三套造型，每套五张立绘，**随包内置**（webp 数据 URI），不需要任何外部提供：

| 造型 | 说明 |
| --- | --- |
| **冬日洋装**（默认） | 与右女仆内置的冬日立绘同套：毛领深蓝大衣 + 鲸鱼围裙 + 热可可 + 雪地靴 |
| **泳装（分体）** | 深蓝蕾丝比基尼 + 半透明白纱笼裙、金色脚链 |
| **浴衣（夏日祭）** | 深蓝浴衣 + 浅蓝鲸鱼浪花纹样 + 陶瓷白蕾丝领口与下摆 + 柔金 obi 腰带，木屐与鲸鱼团扇 |

三套都随会话此刻在做什么更换姿势与表情；判定全部来自宿主自身的 DOM 契约，宿主改写这些属性时退回待机立绘，而不是报错：

| 状态 | 判定信号 | 泳装 / 冬日洋装 / 浴衣 |
| --- | --- | --- |
| 待机 | 以下都不成立 | 微笑挥手，一手叉腰 / 端着热可可站着 / 持鲸鱼团扇微笑，一手叉腰 |
| 思考 | 思考行仍在流式输出：`[data-variant='think'][data-state='running']` | 手指托腮，抬眼思考（三套一致） |
| 工具执行 | 有未结算的工具/命令行：`[data-state='running']` | 端着托盘 / 把热可可端起来，一手叉腰 / 端着饮品托盘，一手叉腰 |
| 回答中 | 助手正文仍在流式输出：`[data-streaming]` | 眨眼比 V，星光点点（三套一致） |
| 出错 | 本轮出现 `[data-state='error']` 或 `[data-state='stopped']` | 惊慌举手、冷汗 / 可可洒了的慌张 / 惊慌举手、冷汗，紧攥团扇 |

「设置 → 皮肤管理 → 深海女仆工坊」里：

- **左女仆造型**：`冬日洋装（与右女仆同套）`（默认）/ `泳装（分体）` / `浴衣（夏日祭）`，切换走配置热重载；
- **左女仆按工作状态切换立绘**：默认开；关闭后固定为待机立绘，且不注册观察器。

出错立绘保持约 4.2 秒再回到待机；进入出错状态时附一次很短的摇摆动画，`prefers-reduced-motion` 下自动关闭。游标只在状态或造型变化时写 `src` 与 `data-maid-left-state` 两处，销毁时还原原值并删除该属性。

想用自己的立绘替换当前造型的任意一态，在皮肤激活**之前**设置（只覆盖给出的键）：

```js
window.__dshMaidAtelierLeftArtwork = { think: 'data:image/webp;base64,...' }
```

三套立绘的来源、生成提示词与绿幕抠像脚本见 `NOTICE` 与 `scripts/build-maid-left-state-art.py`；生成结果的身份/服装/鲸鱼尾/画崩语义质检见 `scripts/review-maid-art.py`。

## 素材来源与许可

本皮肤代码采用 **MIT**；全部美术资源（包括 AI 生成及加工的图片）**禁止商业性使用**，保留相应权利人的版权及既有 **CC BY-NC-SA 4.0** 授权（署名、非商业、相同方式共享）。内嵌于代码或构建产物中的图片同样遵守美术许可。

皮肤素材为衍生创作,署名链(详见 `NOTICE`):

1. **一创 上善**（[Pixiv](https://www.pixiv.net/users/62155430) · [Bilibili：上善无形](https://b23.tv/8h5L4xz)）—— 鲸鱼娘角色形象原作者
2. **二创 ZipZipPipe**（[Pixiv](https://www.pixiv.net/users/18604994) · [Bilibili：ZipZipPipe](https://b23.tv/Pnw6nG8)）—— 在其形象上加入 DeepSeek 元素的女仆鲸鱼娘二次设计(生成模型 GPT Image 2)
3. **三创(本皮肤)Small-tailqwq** —— DeepSeek 元素再设计

许可范围与 MIT 正文见 [LICENSE](LICENSE)，美术许可正文见 [LICENSE-ARTWORK](LICENSE-ARTWORK)，署名链见 [NOTICE](NOTICE)。

## 开发与构建

皮肤工程脚手架(目录模板、`tsdown.client.ts` 构建预设、`dsh-skin-new` 脚手架、皮肤中心与切换脚本)来自 [zhu1090093659/dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)(作者:Solitude)——**本仓库只分发皮肤成品(含预构建 `lib/`),不包含脚手架**。开发构建请在该仓库的 `skins/maid-atelier/` 目录进行:

```sh
cd <dsh-web-ui>/skins/maid-atelier
pnpm build          # 重新生成素材嵌入 + tsdown 构建 lib/
pnpm test           # apply.spec.ts 行为测试
```

构建产物 `lib/` 提交回本仓库即完成一次皮肤更新。

## 许可

许可范围与 MIT 正文见 [LICENSE](LICENSE)，美术许可正文见 [LICENSE-ARTWORK](LICENSE-ARTWORK)，署名链见 [NOTICE](NOTICE)。
