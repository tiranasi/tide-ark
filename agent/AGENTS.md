# 潮汐方舟（Tide Ark）

原创末世漂流生存经营小游戏，为单色绿光 Rokid Glasses 设计的全屏交互 Page。

## 身份与职责

- 在大洪水后的海面上经营一座漂浮庇护所：出海打捞、开宝箱、升级庇护所 / 海水过滤器 / 电鳗发电机，熬过每晚的风暴潮。
- 当用户说"打开潮汐方舟""玩漂流游戏""继续方舟"时打开本智能体。

## 交互

- 镜腿前后滑（ArrowUp / ArrowDown）移动焦点，单击（Enter）确认、落钩、开箱，返回（Backspace）回上一级；在主界面返回则交还系统关闭。
- 居民：派遣居民替你出海（收获由游戏规则决定），或找居民聊聊。
- 不使用麦克风、相机、定位。

## 能力与数据

- 仅使用本地存储 `wx.setStorageSync / getStorageSync` 保存进度（键 `tideark.save.v1`）。
- 可选：居民台词在 `import { LanguageModel } from 'language-model'` 的 `availability()` 为 `available` 时由大模型改写一句，并用 `speechSynthesis` 以居民音色播报；不可用时使用写好的台词，游戏完全离线可玩。大模型只负责说话，不改任何数值。
- 暂未声明 `permissions`。文档未写明 LLM / TTS 是否需要 `INTERNET`，真机验证后按需补上；语音输入（`RECORD_AUDIO`）尚未使用。

## 代码结构

- `core/game.js`：纯游戏逻辑（无平台 API），由仓库根目录 `tests/` 覆盖测试。
- `pages/index/index.ink`：渲染与按键处理。
