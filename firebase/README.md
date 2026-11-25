# Firebase 配置文件放这里（不进仓库）

game.json 的 `firebase.enabled` 改成 `true`，再把 Firebase 控制台下载的两个文件放进这个目录：

| 文件 | 哪里下载 | 要和 game.json 的哪一项一致 |
|---|---|---|
| `google-services.json` | 项目设置 → 你的应用 → Android 应用 | `android.packageName` |
| `GoogleService-Info.plist` | 项目设置 → 你的应用 → Apple 应用 | `ios.bundleId` |

打包时 `tools/native/apply.mjs` 先核对包名，再拷进原生工程。只放了其中一个，就只有那个平台带 Firebase。
这两个文件 `.gitignore` 里排除了：换一台机器打包要重新放（或者在私有仓库里把 `.gitignore` 那两行删掉，提交进去）。

详细说明见 `docs/10-开发底座.md` 第 5.1 节。
