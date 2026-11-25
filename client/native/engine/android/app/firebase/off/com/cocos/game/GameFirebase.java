// 没有 Firebase 的版本（game.json 的 firebase.enabled 为 false，或者没放 firebase/google-services.json；app/build.gradle 的 GAME_FIREBASE）：
// 不依赖 Firebase，统计和脚本错误直接丢掉。
package com.cocos.game;

import android.app.Activity;

import org.json.JSONObject;

final class GameFirebase {
    private GameFirebase() {}

    static void start(Activity act) {}

    static void track(String name, JSONObject params) {}

    static void error(String message, String stack) {}
}
